/**
 * @fileoverview Database configuration factory.
 * Uses TypeORM with better-sqlite3 driver.
 * 
 * SQLite is chosen for:
 *   - Zero-config deployment (no external DB server)
 *   - ACID compliance with WAL mode for concurrent reads
 *   - Single-file persistence suitable for microservice-scale data
 * 
 * Production considerations:
 *   - For horizontal scaling, migrate to PostgreSQL
 *   - SQLite's write lock is acceptable for single-instance deployments
 *   - WAL mode enables concurrent readers while writing
 */
const path = require('path');
const fs = require('fs');

function getDatabaseConfig() {
    const dbPath = process.env.DB_PATH || './data/timeoff.sqlite';
    const absoluteDbPath = path.resolve(dbPath);
    const dbDir = path.dirname(absoluteDbPath);

    // Ensure data directory exists
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    return {
        type: 'better-sqlite3',
        database: absoluteDbPath,
        entities: [path.join(__dirname, '..', 'modules', '**', '*.entity.js')],
        synchronize: process.env.NODE_ENV !== 'production',
        logging: process.env.NODE_ENV === 'development',
        // WAL mode for better concurrent read performance
        prepareDatabase: (db) => {
            db.pragma('journal_mode = WAL');
            db.pragma('foreign_keys = ON');
            db.pragma('busy_timeout = 5000');
        },
    };
}

module.exports = { getDatabaseConfig };
