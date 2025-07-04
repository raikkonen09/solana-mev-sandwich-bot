import { logger } from './logger';
import { SandwichOpportunity, ExecutionResult, BundleTransaction } from '../types';

export enum ErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  SIMULATION_ERROR = 'SIMULATION_ERROR',
  BUNDLE_ERROR = 'BUNDLE_ERROR',
  FLASHLOAN_ERROR = 'FLASHLOAN_ERROR',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  SLIPPAGE_EXCEEDED = 'SLIPPAGE_EXCEEDED',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export enum ErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export interface ErrorInfo {
  type: ErrorType;
  severity: ErrorSeverity;
  message: string;
  details?: any;
  timestamp: number;
  retryable: boolean;
  retryCount?: number;
  maxRetries?: number;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  backoffMultiplier: number;
  retryableErrors: ErrorType[];
}

export class ErrorHandler {
  private errorHistory: ErrorInfo[] = [];
  private retryConfig: RetryConfig;
  private circuitBreakerState: Map<string, any> = new Map();

  constructor(retryConfig?: Partial<RetryConfig>) {
    this.retryConfig = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
      retryableErrors: [
        ErrorType.NETWORK_ERROR,
        ErrorType.TIMEOUT_ERROR,
        ErrorType.BUNDLE_ERROR
      ],
      ...retryConfig
    };
  }

  async handleError(
    error: Error | any,
    context: string,
    metadata?: any
  ): Promise<ErrorInfo> {
    try {
      // Classify the error
      const errorInfo = this.classifyError(error, context, metadata);
      
      // Log the error
      this.logError(errorInfo, context);
      
      // Store in history
      this.addToHistory(errorInfo);
      
      // Update circuit breaker if needed
      this.updateCircuitBreaker(context, errorInfo);
      
      // Trigger alerts for critical errors
      if (errorInfo.severity === ErrorSeverity.CRITICAL) {
        await this.triggerAlert(errorInfo, context);
      }
      
      return errorInfo;
    } catch (handlingError) {
      logger.error('Error in error handler', handlingError);
      return {
        type: ErrorType.UNKNOWN_ERROR,
        severity: ErrorSeverity.HIGH,
        message: 'Error handler failed',
        timestamp: Date.now(),
        retryable: false
      };
    }
  }

  private classifyError(error: Error | any, context: string, metadata?: any): ErrorInfo {
    const timestamp = Date.now();
    let type = ErrorType.UNKNOWN_ERROR;
    let severity = ErrorSeverity.MEDIUM;
    let retryable = false;
    let message = error.message || 'Unknown error';

    // Network-related errors
    if (this.isNetworkError(error)) {
      type = ErrorType.NETWORK_ERROR;
      severity = ErrorSeverity.MEDIUM;
      retryable = true;
    }
    // Timeout errors
    else if (this.isTimeoutError(error)) {
      type = ErrorType.TIMEOUT_ERROR;
      severity = ErrorSeverity.MEDIUM;
      retryable = true;
    }
    // Simulation errors
    else if (this.isSimulationError(error)) {
      type = ErrorType.SIMULATION_ERROR;
      severity = ErrorSeverity.LOW;
      retryable = false;
    }
    // Bundle errors
    else if (this.isBundleError(error)) {
      type = ErrorType.BUNDLE_ERROR;
      severity = ErrorSeverity.HIGH;
      retryable = true;
    }
    // Flashloan errors
    else if (this.isFlashloanError(error)) {
      type = ErrorType.FLASHLOAN_ERROR;
      severity = ErrorSeverity.HIGH;
      retryable = false;
    }
    // Insufficient balance
    else if (this.isInsufficientBalanceError(error)) {
      type = ErrorType.INSUFFICIENT_BALANCE;
      severity = ErrorSeverity.CRITICAL;
      retryable = false;
    }
    // Slippage exceeded
    else if (this.isSlippageError(error)) {
      type = ErrorType.SLIPPAGE_EXCEEDED;
      severity = ErrorSeverity.LOW;
      retryable = false;
    }
    // Validation errors
    else if (this.isValidationError(error)) {
      type = ErrorType.VALIDATION_ERROR;
      severity = ErrorSeverity.MEDIUM;
      retryable = false;
    }

    return {
      type,
      severity,
      message,
      details: {
        originalError: error,
        context,
        metadata,
        stack: error.stack
      },
      timestamp,
      retryable
    };
  }

  private isNetworkError(error: any): boolean {
    const networkErrorPatterns = [
      'network',
      'connection',
      'timeout',
      'ECONNRESET',
      'ENOTFOUND',
      'ETIMEDOUT',
      'fetch failed'
    ];
    
    const errorString = (error.message || error.toString()).toLowerCase();
    return networkErrorPatterns.some(pattern => errorString.includes(pattern));
  }

  private isTimeoutError(error: any): boolean {
    const timeoutPatterns = [
      'timeout',
      'timed out',
      'deadline exceeded',
      'request timeout'
    ];
    
    const errorString = (error.message || error.toString()).toLowerCase();
    return timeoutPatterns.some(pattern => errorString.includes(pattern));
  }

  private isSimulationError(error: any): boolean {
    const simulationPatterns = [
      'simulation failed',
      'simulate transaction',
      'insufficient funds for transaction',
      'blockhash not found'
    ];
    
    const errorString = (error.message || error.toString()).toLowerCase();
    return simulationPatterns.some(pattern => errorString.includes(pattern));
  }

  private isBundleError(error: any): boolean {
    const bundlePatterns = [
      'bundle',
      'jito',
      'bundle rejected',
      'bundle failed',
      'bundle timeout'
    ];
    
    const errorString = (error.message || error.toString()).toLowerCase();
    return bundlePatterns.some(pattern => errorString.includes(pattern));
  }

  private isFlashloanError(error: any): boolean {
    const flashloanPatterns = [
      'flashloan',
      'flash loan',
      'insufficient liquidity',
      'borrow failed',
      'repay failed'
    ];
    
    const errorString = (error.message || error.toString()).toLowerCase();
    return flashloanPatterns.some(pattern => errorString.includes(pattern));
  }

  private isInsufficientBalanceError(error: any): boolean {
    const balancePatterns = [
      'insufficient balance',
      'insufficient funds',
      'not enough balance',
      'account not found'
    ];
    
    const errorString = (error.message || error.toString()).toLowerCase();
    return balancePatterns.some(pattern => errorString.includes(pattern));
  }

  private isSlippageError(error: any): boolean {
    const slippagePatterns = [
      'slippage',
      'price impact',
      'minimum amount out',
      'slippage tolerance exceeded'
    ];
    
    const errorString = (error.message || error.toString()).toLowerCase();
    return slippagePatterns.some(pattern => errorString.includes(pattern));
  }

  private isValidationError(error: any): boolean {
    const validationPatterns = [
      'validation',
      'invalid',
      'malformed',
      'missing required',
      'invalid signature'
    ];
    
    const errorString = (error.message || error.toString()).toLowerCase();
    return validationPatterns.some(pattern => errorString.includes(pattern));
  }

  private logError(errorInfo: ErrorInfo, context: string): void {
    const logData = {
      type: errorInfo.type,
      severity: errorInfo.severity,
      context,
      message: errorInfo.message,
      retryable: errorInfo.retryable,
      timestamp: new Date(errorInfo.timestamp).toISOString()
    };

    switch (errorInfo.severity) {
      case ErrorSeverity.CRITICAL:
        logger.error('CRITICAL ERROR', logData);
        break;
      case ErrorSeverity.HIGH:
        logger.error('HIGH SEVERITY ERROR', logData);
        break;
      case ErrorSeverity.MEDIUM:
        logger.warn('MEDIUM SEVERITY ERROR', logData);
        break;
      case ErrorSeverity.LOW:
        logger.info('LOW SEVERITY ERROR', logData);
        break;
    }
  }

  private addToHistory(errorInfo: ErrorInfo): void {
    this.errorHistory.push(errorInfo);
    
    // Keep only last 1000 errors
    if (this.errorHistory.length > 1000) {
      this.errorHistory = this.errorHistory.slice(-1000);
    }
  }

  private updateCircuitBreaker(context: string, errorInfo: ErrorInfo): void {
    const key = `${context}_${errorInfo.type}`;
    const now = Date.now();
    
    let state = this.circuitBreakerState.get(key) || {
      failures: 0,
      lastFailure: 0,
      state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
      nextAttempt: 0
    };

    if (errorInfo.severity === ErrorSeverity.CRITICAL || 
        errorInfo.severity === ErrorSeverity.HIGH) {
      state.failures++;
      state.lastFailure = now;
      
      // Open circuit breaker after 5 failures
      if (state.failures >= 5 && state.state === 'CLOSED') {
        state.state = 'OPEN';
        state.nextAttempt = now + 60000; // 1 minute timeout
        
        logger.warn('Circuit breaker opened', {
          context,
          errorType: errorInfo.type,
          failures: state.failures
        });
      }
    } else if (errorInfo.severity === ErrorSeverity.LOW) {
      // Reset failures for low severity errors
      state.failures = Math.max(0, state.failures - 1);
    }

    // Transition from OPEN to HALF_OPEN
    if (state.state === 'OPEN' && now > state.nextAttempt) {
      state.state = 'HALF_OPEN';
      logger.info('Circuit breaker transitioning to half-open', {
        context,
        errorType: errorInfo.type
      });
    }

    this.circuitBreakerState.set(key, state);
  }

  private async triggerAlert(errorInfo: ErrorInfo, context: string): Promise<void> {
    try {
      // This would integrate with alerting systems (email, Slack, etc.)
      logger.error('CRITICAL ALERT TRIGGERED', {
        type: errorInfo.type,
        context,
        message: errorInfo.message,
        timestamp: new Date(errorInfo.timestamp).toISOString()
      });

      // Could send to external alerting service
      // await this.sendToAlertingService(errorInfo, context);
    } catch (alertError) {
      logger.error('Failed to trigger alert', alertError);
    }
  }

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: string,
    metadata?: any
  ): Promise<T> {
    let lastError: ErrorInfo | null = null;
    
    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        // Check circuit breaker
        if (this.isCircuitBreakerOpen(context)) {
          throw new Error(`Circuit breaker is open for ${context}`);
        }

        const result = await operation();
        
        // Reset circuit breaker on success
        this.resetCircuitBreaker(context);
        
        if (attempt > 0) {
          logger.info('Operation succeeded after retry', {
            context,
            attempt,
            previousErrors: attempt
          });
        }
        
        return result;
      } catch (error) {
        lastError = await this.handleError(error, context, {
          ...metadata,
          attempt,
          maxRetries: this.retryConfig.maxRetries
        });

        // Don't retry if error is not retryable
        if (!lastError.retryable) {
          logger.debug('Error is not retryable, aborting', {
            context,
            errorType: lastError.type,
            attempt
          });
          break;
        }

        // Don't retry if we've reached max attempts
        if (attempt >= this.retryConfig.maxRetries) {
          logger.warn('Max retries reached', {
            context,
            attempt,
            maxRetries: this.retryConfig.maxRetries
          });
          break;
        }

        // Calculate delay for next retry
        const delay = this.calculateRetryDelay(attempt);
        
        logger.info('Retrying operation after delay', {
          context,
          attempt: attempt + 1,
          delay,
          errorType: lastError.type
        });

        await this.sleep(delay);
      }
    }

    // If we get here, all retries failed
    throw new Error(`Operation failed after ${this.retryConfig.maxRetries} retries: ${lastError?.message}`);
  }

  private calculateRetryDelay(attempt: number): number {
    const delay = this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt);
    return Math.min(delay, this.retryConfig.maxDelay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private isCircuitBreakerOpen(context: string): boolean {
    for (const [key, state] of this.circuitBreakerState) {
      if (key.startsWith(context) && state.state === 'OPEN') {
        return Date.now() < state.nextAttempt;
      }
    }
    return false;
  }

  private resetCircuitBreaker(context: string): void {
    for (const [key, state] of this.circuitBreakerState) {
      if (key.startsWith(context)) {
        state.failures = 0;
        state.state = 'CLOSED';
        state.nextAttempt = 0;
      }
    }
  }

  async handleSandwichExecutionError(
    opportunity: SandwichOpportunity,
    error: Error,
    executionContext: any
  ): Promise<ExecutionResult> {
    try {
      const errorInfo = await this.handleError(error, 'sandwich_execution', {
        opportunityId: opportunity.id,
        targetTransaction: opportunity.targetTransaction.signature,
        estimatedProfit: opportunity.estimatedProfit.toString(),
        executionContext
      });

      // Determine if we should retry the sandwich
      const shouldRetry = this.shouldRetrySandwich(errorInfo, opportunity);

      return {
        bundleId: `failed_${opportunity.id}_${Date.now()}`,
        success: false,
        error: errorInfo.message,
        executionTime: 0,
        retryable: shouldRetry
      } as ExecutionResult;
    } catch (handlingError) {
      logger.error('Error handling sandwich execution error', handlingError);
      return {
        bundleId: `error_${opportunity.id}_${Date.now()}`,
        success: false,
        error: 'Error handling failed',
        executionTime: 0,
        retryable: false
      } as ExecutionResult;
    }
  }

  private shouldRetrySandwich(errorInfo: ErrorInfo, opportunity: SandwichOpportunity): boolean {
    // Don't retry if error is not retryable
    if (!errorInfo.retryable) {
      return false;
    }

    // Don't retry if opportunity is too old
    const opportunityAge = Date.now() - opportunity.detectedAt;
    if (opportunityAge > 10000) { // 10 seconds
      return false;
    }

    // Don't retry if profit is too low to justify retry costs
    if (opportunity.estimatedProfit.lt(0.01)) { // Less than $0.01
      return false;
    }

    // Don't retry certain error types for sandwiches
    const nonRetryableForSandwich = [
      ErrorType.SLIPPAGE_EXCEEDED,
      ErrorType.INSUFFICIENT_BALANCE,
      ErrorType.VALIDATION_ERROR
    ];

    if (nonRetryableForSandwich.includes(errorInfo.type)) {
      return false;
    }

    return true;
  }

  getErrorStatistics(timeWindow: number = 3600000): any { // Default 1 hour
    const now = Date.now();
    const recentErrors = this.errorHistory.filter(
      error => now - error.timestamp < timeWindow
    );

    const errorsByType = new Map<ErrorType, number>();
    const errorsBySeverity = new Map<ErrorSeverity, number>();

    for (const error of recentErrors) {
      errorsByType.set(error.type, (errorsByType.get(error.type) || 0) + 1);
      errorsBySeverity.set(error.severity, (errorsBySeverity.get(error.severity) || 0) + 1);
    }

    return {
      timeWindow,
      totalErrors: recentErrors.length,
      errorsByType: Object.fromEntries(errorsByType),
      errorsBySeverity: Object.fromEntries(errorsBySeverity),
      errorRate: recentErrors.length / (timeWindow / 1000), // Errors per second
      circuitBreakerStates: Object.fromEntries(this.circuitBreakerState)
    };
  }

  getStatus(): any {
    const stats = this.getErrorStatistics();
    
    return {
      retryConfig: this.retryConfig,
      errorHistory: {
        total: this.errorHistory.length,
        recent: stats.totalErrors
      },
      circuitBreakers: {
        total: this.circuitBreakerState.size,
        open: Array.from(this.circuitBreakerState.values())
          .filter(state => state.state === 'OPEN').length
      },
      statistics: stats
    };
  }

  clearHistory(): void {
    this.errorHistory = [];
    this.circuitBreakerState.clear();
    logger.info('Error history and circuit breaker state cleared');
  }
}

