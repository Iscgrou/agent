/* eslint-disable camelcase */

export const shorthands = undefined;

export async function up(pgm) {
    // Create enum for user roles
    pgm.createType('user_role', ['admin', 'user', 'agent']);

    // Create enum for user status
    pgm.createType('user_status', ['active', 'inactive', 'suspended']);

    // Create users table
    pgm.createTable('users', {
        id: {
            type: 'uuid',
            primaryKey: true,
            default: pgm.func('gen_random_uuid()')
        },
        email: {
            type: 'varchar(255)',
            notNull: true,
            unique: true
        },
        password_hash: {
            type: 'varchar(255)',
            notNull: true
        },
        full_name: {
            type: 'varchar(255)',
            notNull: true
        },
        role: {
            type: 'user_role',
            notNull: true,
            default: 'user'
        },
        status: {
            type: 'user_status',
            notNull: true,
            default: 'active'
        },
        last_login: {
            type: 'timestamp with time zone'
        },
        login_attempts: {
            type: 'integer',
            default: 0
        },
        lockout_until: {
            type: 'timestamp with time zone'
        },
        preferences: {
            type: 'jsonb',
            default: '{}'
        },
        created_at: {
            type: 'timestamp with time zone',
            notNull: true,
            default: pgm.func('current_timestamp')
        },
        updated_at: {
            type: 'timestamp with time zone',
            notNull: true,
            default: pgm.func('current_timestamp')
        }
    });

    // Create indexes
    pgm.createIndex('users', 'email');
    pgm.createIndex('users', 'status');
    pgm.createIndex('users', 'role');

    // Create updated_at trigger
    pgm.createFunction(
        'update_updated_at_column',
        [],
        {
            returns: 'trigger',
            language: 'plpgsql',
        },
        `
        BEGIN
            NEW.updated_at = current_timestamp;
            RETURN NEW;
        END;
        `
    );

    pgm.createTrigger(
        'users',
        'update_updated_at_trigger',
        {
            when: 'BEFORE',
            operation: 'UPDATE',
            level: 'ROW',
            function: 'update_updated_at_column',
        }
    );
}

export async function down(pgm) {
    // Drop trigger
    pgm.dropTrigger('users', 'update_updated_at_trigger');
    pgm.dropFunction('update_updated_at_column');

    // Drop table
    pgm.dropTable('users');

    // Drop enums
    pgm.dropType('user_status');
    pgm.dropType('user_role');
}
