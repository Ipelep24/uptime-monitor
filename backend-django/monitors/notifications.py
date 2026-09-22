import os
import smtplib
from email.mime.text import MIMEText

import requests

DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL", "")
ALERT_EMAIL_TO = os.getenv("ALERT_EMAIL_TO", "")
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "")

def send_discord(message: str):
    if not DISCORD_WEBHOOK_URL:
        return
    try: 
        requests.post(DISCORD_WEBHOOK_URL, json={"content": message}, timeout=5)
    except requests.RequestException as e:
        print(f'Discord notification failed: {e}')

def send_email(subject: str, body: str):
    if not (SMTP_HOST and SMTP_USER and SMTP_PASSWORD and ALERT_EMAIL_TO):
        return
    try:
        msg = MIMEText(body)
        msg["Subject"] = subject
        msg["From"] = SMTP_FROM or SMTP_USER
        msg["To"] = ALERT_EMAIL_TO

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
    except Exception as e:
        print (f"Email notification failed: {e}")

def notify_incident_opened(monitor_name: str, reason: str):
    send_discord(f"🔴 **{monitor_name}** is DOWN — {reason}")
    send_email(
        f"[Uptime Monitor] {monitor_name} is DOWN",
        f"{monitor_name} started failing.\nReason: {reason}",
    )

def notify_incident_resolved(monitor_name: str):
    send_discord(f"🟢 **{monitor_name}** is back UP")
    send_email(
        f"[Uptime Monitor] {monitor_name} is back UP",
        f"{monitor_name} has recovered.",
    )