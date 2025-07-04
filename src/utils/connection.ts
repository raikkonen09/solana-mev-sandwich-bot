import { Connection, ConnectionConfig } from '@solana/web3.js';
import { logger } from './logger';

export class ConnectionManager {
  private connections: Connection[] = [];
  private currentIndex = 0;
  private healthChecks: Map<string, boolean> = new Map();

  constructor(private endpoints: string[]) {
    this.initializeConnections();
    this.startHealthChecks();
  }

  private initializeConnections(): void {
    const config: ConnectionConfig = {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000,
      wsEndpoint: undefined
    };

    this.connections = this.endpoints.map(endpoint => {
      logger.info(`Initializing connection to ${endpoint}`);
      return new Connection(endpoint, config);
    });
  }

  private async startHealthChecks(): Promise<void> {
    setInterval(async () => {
      for (let i = 0; i < this.connections.length; i++) {
        try {
          const startTime = Date.now();
          await this.connections[i].getLatestBlockhash();
          const latency = Date.now() - startTime;
          
          this.healthChecks.set(this.endpoints[i], latency < 1000);
          
          if (latency > 1000) {
            logger.warn(`High latency detected for ${this.endpoints[i]}: ${latency}ms`);
          }
        } catch (error) {
          logger.error(`Health check failed for ${this.endpoints[i]}`, error);
          this.healthChecks.set(this.endpoints[i], false);
        }
      }
    }, 30000); // Check every 30 seconds
  }

  getConnection(): Connection {
    // Round-robin with health check
    let attempts = 0;
    while (attempts < this.connections.length) {
      const connection = this.connections[this.currentIndex];
      const endpoint = this.endpoints[this.currentIndex];
      
      this.currentIndex = (this.currentIndex + 1) % this.connections.length;
      
      if (this.healthChecks.get(endpoint) !== false) {
        return connection;
      }
      
      attempts++;
    }
    
    // If all connections are unhealthy, return the first one
    logger.warn('All connections appear unhealthy, using first connection');
    return this.connections[0];
  }

  getHealthyConnections(): Connection[] {
    return this.connections.filter((_, index) => 
      this.healthChecks.get(this.endpoints[index]) !== false
    );
  }

  async getBestConnection(): Promise<Connection> {
    const promises = this.connections.map(async (connection, index) => {
      try {
        const startTime = Date.now();
        await connection.getLatestBlockhash();
        const latency = Date.now() - startTime;
        return { connection, latency, index };
      } catch (error) {
        return { connection, latency: Infinity, index };
      }
    });

    const results = await Promise.all(promises);
    const best = results.reduce((prev, current) => 
      current.latency < prev.latency ? current : prev
    );

    logger.debug(`Selected connection ${this.endpoints[best.index]} with latency ${best.latency}ms`);
    return best.connection;
  }

  getConnectionStats(): any {
    return {
      totalConnections: this.connections.length,
      healthyConnections: this.getHealthyConnections().length,
      endpoints: this.endpoints.map((endpoint, index) => ({
        endpoint,
        healthy: this.healthChecks.get(endpoint) !== false
      }))
    };
  }
}

