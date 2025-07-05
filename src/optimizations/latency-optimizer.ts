/**
 * Latency Optimization Module
 * Implements optimizations discovered during dry run testing
 */

import { Connection } from '@solana/web3.js';

export interface LatencyMetrics {
  rpcLatency: number;
  blockLatency: number;
  transactionLatency: number;
  averageLatency: number;
}

export interface OptimizedEndpoint {
  url: string;
  latency: number;
  reliability: number;
  priority: number;
}

export class LatencyOptimizer {
  private endpoints: OptimizedEndpoint[] = [];
  private metrics: Map<string, LatencyMetrics> = new Map();
  private currentBestEndpoint: string = '';

  constructor(private initialEndpoints: string[]) {
    this.initializeEndpoints();
  }

  private initializeEndpoints(): void {
    this.endpoints = this.initialEndpoints.map(url => ({
      url,
      latency: 1000, // Start with high latency
      reliability: 0.5, // Start with medium reliability
      priority: 1
    }));
  }

  async benchmarkEndpoints(): Promise<OptimizedEndpoint[]> {
    console.log('🚀 Benchmarking RPC endpoints for optimal performance...');
    
    const results: OptimizedEndpoint[] = [];
    
    for (const endpoint of this.endpoints) {
      try {
        const metrics = await this.measureEndpointPerformance(endpoint.url);
        
        const optimizedEndpoint: OptimizedEndpoint = {
          url: endpoint.url,
          latency: metrics.averageLatency,
          reliability: await this.measureReliability(endpoint.url),
          priority: this.calculatePriority(metrics.averageLatency, await this.measureReliability(endpoint.url))
        };
        
        results.push(optimizedEndpoint);
        this.metrics.set(endpoint.url, metrics);
        
        console.log(`   ✅ ${endpoint.url.slice(0, 50)}...`);
        console.log(`      Latency: ${metrics.averageLatency}ms`);
        console.log(`      Reliability: ${(await this.measureReliability(endpoint.url) * 100).toFixed(1)}%`);
        console.log(`      Priority: ${optimizedEndpoint.priority}`);
        
      } catch (error: any) {
        console.log(`   ❌ ${endpoint.url.slice(0, 50)}... - Failed: ${error.message}`);
        
        results.push({
          url: endpoint.url,
          latency: 9999,
          reliability: 0,
          priority: 0
        });
      }
    }
    
    // Sort by priority (higher is better)
    results.sort((a, b) => b.priority - a.priority);
    this.endpoints = results;
    
    if (results.length > 0) {
      this.currentBestEndpoint = results[0].url;
      console.log(`\n🏆 Best endpoint: ${this.currentBestEndpoint}`);
      console.log(`   Latency: ${results[0].latency}ms`);
      console.log(`   Reliability: ${(results[0].reliability * 100).toFixed(1)}%`);
    }
    
    return results;
  }

  private async measureEndpointPerformance(url: string): Promise<LatencyMetrics> {
    const connection = new Connection(url, 'confirmed');
    const measurements: number[] = [];
    
    // Perform multiple measurements for accuracy
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      
      try {
        await connection.getSlot();
        const latency = Date.now() - start;
        measurements.push(latency);
      } catch (error) {
        measurements.push(9999); // High penalty for failures
      }
      
      // Small delay between measurements
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const averageLatency = measurements.reduce((sum, lat) => sum + lat, 0) / measurements.length;
    
    return {
      rpcLatency: averageLatency,
      blockLatency: averageLatency * 1.2, // Estimate
      transactionLatency: averageLatency * 1.5, // Estimate
      averageLatency
    };
  }

  private async measureReliability(url: string): Promise<number> {
    const connection = new Connection(url, 'confirmed');
    let successCount = 0;
    const totalAttempts = 10;
    
    for (let i = 0; i < totalAttempts; i++) {
      try {
        await connection.getVersion();
        successCount++;
      } catch (error) {
        // Failed attempt
      }
      
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    return successCount / totalAttempts;
  }

  private calculatePriority(latency: number, reliability: number): number {
    // Lower latency and higher reliability = higher priority
    const latencyScore = Math.max(0, 1000 - latency) / 1000; // Normalize to 0-1
    const reliabilityScore = reliability; // Already 0-1
    
    // Weight reliability more heavily than latency for MEV
    return (latencyScore * 0.3) + (reliabilityScore * 0.7);
  }

  getBestEndpoint(): string {
    return this.currentBestEndpoint || this.initialEndpoints[0];
  }

  getOptimizedEndpoints(): OptimizedEndpoint[] {
    return [...this.endpoints].sort((a, b) => b.priority - a.priority);
  }

  async adaptiveEndpointSelection(): Promise<string> {
    // Continuously monitor and switch to better endpoints
    const currentTime = Date.now();
    
    // Re-benchmark every 5 minutes
    if (!this.lastBenchmark || currentTime - this.lastBenchmark > 300000) {
      await this.benchmarkEndpoints();
      this.lastBenchmark = currentTime;
    }
    
    return this.getBestEndpoint();
  }

  private lastBenchmark: number = 0;

  getLatencyMetrics(endpoint: string): LatencyMetrics | undefined {
    return this.metrics.get(endpoint);
  }

  // Connection pooling for better performance
  private connectionPool: Map<string, Connection> = new Map();

  getOptimizedConnection(endpoint?: string): Connection {
    const targetEndpoint = endpoint || this.getBestEndpoint();
    
    if (!this.connectionPool.has(targetEndpoint)) {
      this.connectionPool.set(targetEndpoint, new Connection(targetEndpoint, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 30000,
        disableRetryOnRateLimit: false,
        httpHeaders: {
          'User-Agent': 'Solana-MEV-Bot/1.0'
        }
      }));
    }
    
    return this.connectionPool.get(targetEndpoint)!;
  }

  // Cleanup connections
  cleanup(): void {
    this.connectionPool.clear();
  }
}

