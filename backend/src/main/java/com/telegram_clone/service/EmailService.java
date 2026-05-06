package com.telegram_clone.service;

import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;

@Service
public class EmailService {

    // Spring automatically injects JavaMailSender using the config in application.yaml.
    private final JavaMailSender mailSender;

    public EmailService(JavaMailSender mailSender) {
        this.mailSender = mailSender;
    }

    public void sendOtpEmail(String toEmail, String otp) {
        // SimpleMailMessage is for plain text emails — no HTML, no attachments.
        SimpleMailMessage message = new SimpleMailMessage();
        message.setTo(toEmail);
        message.setSubject(otp + " is your Telegram Clone login code");
        message.setText("Verification Code: " + otp + "\n\nThis code expires in 5 minutes." +
                "\nDo not share this code with anyone, not even if they claim to be Telegram!" +
                "\nIf you did not request this code, simply ignore this message.");

        // This is where the actual connection happens and the email gets sent.
        mailSender.send(message);
    }
}
