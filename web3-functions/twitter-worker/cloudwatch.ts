import { CloudWatchLogsClient, PutLogEventsCommand, CreateLogStreamCommand } from "@aws-sdk/client-cloudwatch-logs";

export interface CloudWatchLoggerConfig {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    logGroupName: string;
    logStreamName?: string;
    bufferSize?: number; // Maximum number of logs to buffer before auto-flush
    flushInterval?: number; // Auto-flush interval in milliseconds
    enabled?: boolean; // Whether to also log to console
}

export interface Logger {
    info(...args: any[]): void;
    error(...args: any[]): void;
    warn(...args: any[]): void;
    debug(...args: any[]): void;
}

export class CloudwatchLogger implements Logger {
    private client: CloudWatchLogsClient;
    private config: CloudWatchLoggerConfig;
    private logStreamName: string;
    private buffer: Array<{ timestamp: number; message: string; level: string }> = [];
    private flushTimer?: NodeJS.Timeout;
    private isFlushing: boolean = false;

    constructor(config: CloudWatchLoggerConfig) {
        this.config = config;
        this.logStreamName = config.logStreamName || this.generateLogStreamName();

        this.client = new CloudWatchLogsClient({
            region: config.region,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
        });

        // Set up auto-flush timer if interval is specified
        if (config.flushInterval && config.flushInterval > 0) {
            this.flushTimer = setInterval(() => {
                this.flushAndSend().catch(error => {
                    console.error('Auto-flush failed:', error);
                });
            }, config.flushInterval);
        }
    }

    /**
     * Converts any value to a string representation
     * @param value - Any value to convert
     * @returns String representation of the value
     */
    private valueToString(value: any): string {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';

        const type = typeof value;

        switch (type) {
            case 'string':
                return value;
            case 'number':
            case 'boolean':
                return String(value);
            case 'object':
                if (value instanceof Map) {
                    return `Map(${value.size}) {${Array.from(value.entries()).map(([k, v]) => `${k}: ${this.valueToString(v)}`).join(', ')}}`;
                }
                if (value instanceof Set) {
                    return `Set(${value.size}) {${Array.from(value).map(v => this.valueToString(v)).join(', ')}}`;
                }
                if (Array.isArray(value)) {
                    return `[${value.map(v => this.valueToString(v)).join(', ')}]`;
                }
                if (value instanceof Error) {
                    return `${value.name}: ${value.message}`;
                }
                try {
                    return JSON.stringify(value, null, 2);
                } catch (e) {
                    return `[Object: ${Object.prototype.toString.call(value)}]`;
                }
            case 'function':
                return `[Function: ${value.name || 'anonymous'}]`;
            case 'symbol':
                return value.toString();
            default:
                return String(value);
        }
    }

    /**
     * Converts multiple arguments to a single string message
     * @param args - Any number of arguments of any type
     * @returns Formatted string message
     */
    private formatMessage(...args: any[]): string {
        if (args.length === 0) return '';
        if (args.length === 1) return this.valueToString(args[0]);

        return args.map(arg => this.valueToString(arg)).join(' ');
    }

    /**
     * Logs any data to the buffer (doesn't send immediately)
     * @param args - Any number of arguments of any type
     * @param level - Log level (optional, defaults to 'INFO')
     */
    log(level: string = 'INFO', ...args: any[]): void {
        if (!this.config.enabled) {
            return;
        }

        const timestamp = Date.now();
        const message = this.formatMessage(...args);
        const formattedMessage = `[${level}] ${message}`;

        this.buffer.push({
            timestamp,
            message: formattedMessage,
            level
        });

        // Auto-flush if buffer size limit is reached
        const bufferSize = this.config.bufferSize || 100;
        if (this.buffer.length >= bufferSize) {
            this.flushAndSend().catch(error => {
                console.error('Auto-flush failed:', error);
            });
        }
    }

    /**
     * Convenience methods for different log levels
     */
    info(...args: any[]): void {
        this.log('INFO', ...args);
    }

    error(...args: any[]): void {
        this.log('ERROR', ...args);
    }

    warn(...args: any[]): void {
        this.log('WARN', ...args);
    }

    debug(...args: any[]): void {
        this.log('DEBUG', ...args);
    }

    /**
     * Flushes the buffer and sends all logs to CloudWatch
     * @param waitTime - Maximum time to wait for response in seconds (0 = fire and forget)
     * @returns Promise that resolves when logs are sent or timeout is reached
     */
    async flushAndSend(waitTime: number = 0): Promise<void> {
        if (this.isFlushing || this.buffer.length === 0) {
            return;
        }

        this.isFlushing = true;
        const logsToSend = [...this.buffer];
        this.buffer = []; // Clear the buffer

        try {
            if (logsToSend.length > 0) {
                if (waitTime > 0) {
                    // Wait for response with timeout
                    await Promise.race([
                        this.sendLogsToCloudWatch(logsToSend),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error(`CloudWatch flush timeout after ${waitTime}s`)), waitTime * 1000)
                        )
                    ]);
                } else {
                    // Fire and forget - don't wait for response
                    this.sendLogsToCloudWatch(logsToSend).catch(error => {
                        console.error('Background CloudWatch flush failed:', error);
                        // Fallback to console.log if CloudWatch fails
                        logsToSend.forEach(log => {
                            console.log(`[${log.level}]`, log.message);
                        });
                    });
                }
            }
        } catch (error) {
            console.error('Failed to send logs to CloudWatch:', error);
            // Fallback to console.log if CloudWatch fails
            logsToSend.forEach(log => {
                console.log(`[${log.level}]`, log.message);
            });
        } finally {
            this.isFlushing = false;
        }
    }

    /**
 * Sends multiple logs to CloudWatch using AWS SDK
 */
    private async sendLogsToCloudWatch(logs: Array<{ timestamp: number; message: string; level: string }>): Promise<void> {
        const logEvents = logs.map(log => ({
            timestamp: log.timestamp,
            message: log.message
        }));

        const command = new PutLogEventsCommand({
            logGroupName: this.config.logGroupName,
            logStreamName: this.logStreamName,
            logEvents
        });

        try {
            await this.client.send(command);
        } catch (error: any) {
            // Handle any other errors (network, permissions, etc.)
            throw error;
        }
    }

    /**
 * Initialize the log stream in CloudWatch
 * This should be called before sending any logs
 */
    async initializeLogStream(): Promise<void> {
        try {
            const command = new CreateLogStreamCommand({
                logGroupName: this.config.logGroupName,
                logStreamName: this.logStreamName
            });

            await this.client.send(command);
        } catch (error: any) {
            if (error.name === 'ResourceNotFoundException') {
                console.error('Log group does not exist. Please create it first:', this.config.logGroupName);
            } else if (error.name === 'ResourceAlreadyExistsException') {
                // Log stream already exists, which is fine - we can continue
                console.log('Log stream already exists, continuing...');
            } else {
                console.error('Failed to initialize CloudWatch log stream:', error);
            }
        }
    }

    /**
     * Cleanup resources (stops auto-flush timer)
     */
    cleanup(): void {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = undefined;
        }
    }

    /**
     * Get the current buffer size
     */
    getBufferSize(): number {
        return this.buffer.length;
    }

    /**
     * Check if the logger is currently flushing
     */
    isCurrentlyFlushing(): boolean {
        return this.isFlushing;
    }

    private generateLogStreamName(): string {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toISOString().split('T')[1].split('.')[0].replace(/:/g, '-');
        return `web3-function-${dateStr}-${timeStr}`;
    }

    /**
     * Test method to demonstrate the improved logging capabilities
     * This can be used for testing different data types
     */
    testLogging(): void {
        // Test different data types
        this.info('Simple string message');
        this.info('Number:', 42);
        this.info('Boolean:', true);
        this.info('Array:', [1, 2, 3, 'test']);
        this.info('Object:', { name: 'test', value: 123 });

        // Test Map
        const testMap = new Map([['key1', 'value1'], ['key2', 'value2']]);
        this.info('Map:', testMap);

        // Test Set
        const testSet = new Set(['a', 'b', 'c']);
        this.info('Set:', testSet);

        // Test Error
        this.error('Error object:', new Error('Test error'));

        // Test multiple arguments
        this.info('Multiple args:', 'string', 123, { obj: 'value' }, [1, 2, 3]);

        // Test null and undefined
        this.info('Null:', null);
        this.info('Undefined:', undefined);
    }
}