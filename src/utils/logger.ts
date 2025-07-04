import winston from 'winston';
import { LogEntry } from '../types';

class Logger {
  private logger: winston.Logger;

  constructor() {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'solana-mev-bot' },
      transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      ]
    });
  }

  info(message: string, data?: any): void {
    this.logger.info(message, data);
  }

  warn(message: string, data?: any): void {
    this.logger.warn(message, data);
  }

  error(message: string, error?: Error | any): void {
    this.logger.error(message, error);
  }

  debug(message: string, data?: any): void {
    this.logger.debug(message, data);
  }

  logOpportunity(opportunity: any): void {
    this.info('Sandwich opportunity detected', {
      id: opportunity.id,
      profit: opportunity.estimatedProfit.toString(),
      target: opportunity.targetTransaction.signature,
      dex: opportunity.targetTransaction.dex
    });
  }

  logExecution(result: any): void {
    if (result.success) {
      this.info('Sandwich executed successfully', {
        bundleId: result.bundleId,
        profit: result.actualProfit?.toString(),
        gasUsed: result.gasUsed
      });
    } else {
      this.error('Sandwich execution failed', {
        bundleId: result.bundleId,
        error: result.error
      });
    }
  }

  logMetrics(metrics: any): void {
    this.info('Bot metrics update', metrics);
  }
}

export const logger = new Logger();

