package com.telegram_clone.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.file.Path;
import java.nio.file.Paths;

@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // Serve uploaded files (profile pics, message attachments) at /uploads/**.
        Path uploads = Paths.get("uploads").toAbsolutePath().normalize();
        registry.addResourceHandler("/uploads/**")
                .addResourceLocations("file:" + toUrl(uploads) + "/");

        // Serve the entire frontend/ directory at its natural paths.
        // CWD when running from the backend/ folder is backend/, so ../frontend/ is correct.
        // More specific handlers (/uploads/**, /api/**) take priority over this catch-all.
        Path frontend = Paths.get("..").toAbsolutePath().normalize().resolve("frontend");
        registry.addResourceHandler("/**")
                .addResourceLocations("file:" + toUrl(frontend) + "/");
    }

    // Redirect bare "/" to the app entry-point so users can just open http://localhost:8080
    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        registry.addRedirectViewController("/", "/src/index.html");
    }

    private String toUrl(Path path) {
        return path.toString().replace('\\', '/');
    }
}
