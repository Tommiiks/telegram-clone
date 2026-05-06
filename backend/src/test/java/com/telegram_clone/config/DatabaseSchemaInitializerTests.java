package com.telegram_clone.config;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import static org.assertj.core.api.Assertions.assertThat;

class DatabaseSchemaInitializerTests {

    @Test
    void addsMissingMessageColumnsForExistingH2Database() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                "jdbc:h2:mem:schema-init-test;DB_CLOSE_DELAY=-1",
                "sa",
                ""
        );
        dataSource.setDriverClassName("org.h2.Driver");

        JdbcTemplate jdbcTemplate = new JdbcTemplate(dataSource);
        jdbcTemplate.execute(
                """
                CREATE TABLE MESSAGE (
                    ID BIGINT AUTO_INCREMENT PRIMARY KEY,
                    CONTENT VARCHAR(255)
                )
                """
        );

        new DatabaseSchemaInitializer(jdbcTemplate).run(null);

        Integer asDocumentColumns = jdbcTemplate.queryForObject(
                """
                SELECT COUNT(*)
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = 'MESSAGE'
                  AND COLUMN_NAME = 'AS_DOCUMENT'
                """,
                Integer.class
        );
        String asDocumentNullable = jdbcTemplate.query(
                """
                SELECT IS_NULLABLE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = 'MESSAGE'
                  AND COLUMN_NAME = 'AS_DOCUMENT'
                """,
                rs -> rs.next() ? rs.getString(1) : null
        );
        Integer contentLength = jdbcTemplate.query(
                """
                SELECT CHARACTER_MAXIMUM_LENGTH
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = 'MESSAGE'
                  AND COLUMN_NAME = 'CONTENT'
                """,
                rs -> rs.next() ? rs.getInt(1) : null
        );
        Integer replyColumns = jdbcTemplate.queryForObject(
                """
                SELECT COUNT(*)
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = 'MESSAGE'
                  AND COLUMN_NAME = 'REPLY_TO_MESSAGE_ID'
                """,
                Integer.class
        );
        Integer editedColumns = jdbcTemplate.queryForObject(
                """
                SELECT COUNT(*)
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = 'MESSAGE'
                  AND COLUMN_NAME = 'EDITED_AT'
                """,
                Integer.class
        );

        assertThat(asDocumentColumns).isEqualTo(1);
        assertThat(asDocumentNullable).isEqualTo("NO");
        assertThat(contentLength).isEqualTo(4000);
        assertThat(replyColumns).isEqualTo(1);
        assertThat(editedColumns).isEqualTo(1);
    }
}
