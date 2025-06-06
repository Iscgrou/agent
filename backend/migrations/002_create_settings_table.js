/* eslint-disable camelcase */

export const shorthands = undefined;

export async function up(pgm) {
    // Create settings table
    pgm.createTable('settings', {
        id: {
            type: 'integer',
            primaryKey: true,
            default: 1,
            check: 'id = 1' // Ensures only one row exists
        },
        vertex_ai_key: {
            type: 'text',
            allowNull: true
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

    // Create updated_at trigger
    pgm.createFunction(
        'update_settings_updated_at',
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
        'settings',
        'update_settings_updated_at_trigger',
        {
            when: 'BEFORE',
            operation: 'UPDATE',
            level: 'ROW',
            function: 'update_settings_updated_at',
        }
    );

    // Add constraint to ensure only one row exists
    pgm.sql(`
        CREATE UNIQUE INDEX single_settings_row ON settings ((id IS NOT NULL));
    `);
}

export async function down(pgm) {
    // Drop trigger
    pgm.dropTrigger('settings', 'update_settings_updated_at_trigger');
    pgm.dropFunction('update_settings_updated_at');

    // Drop table
    pgm.dropTable('settings');
}
