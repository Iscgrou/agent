import pg from 'pg';
import config from '../config/index.js';
import logger from '../utils/logger.js';

const { Pool } = pg;

class Database {
    constructor() {
        this.pool = new Pool({
            host: config.database.host,
            port: config.database.port,
            database: config.database.name,
            user: config.database.user,
            password: config.database.password,
            ssl: config.database.ssl,
            max: config.database.maxConnections,
            idleTimeoutMillis: config.database.idleTimeoutMillis,
            connectionTimeoutMillis: 2000,
        });

        // Handle pool errors
        this.pool.on('error', (err) => {
            logger.error('Unexpected error on idle client', err);
            process.exit(-1);
        });

        this.pool.on('connect', () => {
            logger.info('New client connected to database');
        });
    }

    async query(text, params) {
        const start = Date.now();
        try {
            const res = await this.pool.query(text, params);
            const duration = Date.now() - start;
            logger.debug('Executed query', { text, duration, rows: res.rowCount });
            return res;
        } catch (err) {
            logger.error('Error executing query', { text, error: err.message });
            throw err;
        }
    }

    async getClient() {
        const client = await this.pool.connect();
        const query = client.query.bind(client);
        const release = client.release.bind(client);

        // Set a timeout of 5 seconds
        const timeout = setTimeout(() => {
            logger.error('A client has been checked out for too long.');
            logger.error(`The last executed query on this client was: ${client.lastQuery}`);
        }, 5000);

        // Monkey patch the query method to keep track of the last query
        client.query = (...args) => {
            client.lastQuery = args;
            return query(...args);
        };

        client.release = () => {
            clearTimeout(timeout);
            client.query = query;
            client.release = release;
            return release();
        };

        return client;
    }

    async transaction(callback) {
        const client = await this.getClient();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    async healthCheck() {
        try {
            await this.query('SELECT 1');
            return true;
        } catch (err) {
            logger.error('Database health check failed', err);
            return false;
        }
    }

    async close() {
        try {
            await this.pool.end();
            logger.info('Database pool has been closed');
        } catch (err) {
            logger.error('Error closing database pool', err);
            throw err;
        }
    }
}

// Create and export a singleton instance
const database = new Database();
export default database;
