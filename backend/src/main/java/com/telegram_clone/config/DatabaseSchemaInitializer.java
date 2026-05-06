package com.telegram_clone.config;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class DatabaseSchemaInitializer implements ApplicationRunner {

    private final JdbcTemplate jdbcTemplate;

    public DatabaseSchemaInitializer(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!tableExists("MESSAGE"))
            return;

        ensureAsDocumentColumn();
        ensureColumn("MESSAGE", "EDITED_AT", "TIMESTAMP");
        ensureColumn("MESSAGE", "REPLY_TO_MESSAGE_ID", "BIGINT");
        widenContentColumn();
    }

    private void ensureAsDocumentColumn() {
        ensureColumn("MESSAGE", "AS_DOCUMENT", "BOOLEAN DEFAULT FALSE");
        jdbcTemplate.execute("UPDATE MESSAGE SET AS_DOCUMENT = FALSE WHERE AS_DOCUMENT IS NULL");
        jdbcTemplate.execute("ALTER TABLE MESSAGE ALTER COLUMN AS_DOCUMENT SET DEFAULT FALSE");
        jdbcTemplate.execute("ALTER TABLE MESSAGE ALTER COLUMN AS_DOCUMENT SET NOT NULL");
    }

    private void ensureColumn(String table, String column, String definition) {
        if (columnExists(table, column))
            return;

        jdbcTemplate.execute("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition);
    }

    private void widenContentColumn() {
        Integer currentLength = jdbcTemplate.query(
                """
                SELECT CHARACTER_MAXIMUM_LENGTH
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE UPPER(TABLE_NAME) = 'MESSAGE'
                  AND UPPER(COLUMN_NAME) = 'CONTENT'
                """,
                rs -> rs.next() ? rs.getInt(1) : null
        );

        if (currentLength == null || currentLength >= 4000)
            return;

        jdbcTemplate.execute("ALTER TABLE MESSAGE ALTER COLUMN CONTENT VARCHAR(4000)");
    }

    private boolean tableExists(String table) {
        Integer count = jdbcTemplate.queryForObject(
                """
                SELECT COUNT(*)
                FROM INFORMATION_SCHEMA.TABLES
                WHERE UPPER(TABLE_NAME) = ?
                """,
                Integer.class,
                table
        );
        return count != null && count > 0;
    }

    private boolean columnExists(String table, String column) {
        Integer count = jdbcTemplate.queryForObject(
                """
                SELECT COUNT(*)
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE UPPER(TABLE_NAME) = ?
                  AND UPPER(COLUMN_NAME) = ?
                """,
                Integer.class,
                table,
                column
        );
        return count != null && count > 0;
    }
}
