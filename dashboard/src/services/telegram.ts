const STORAGE_KEY = 'mfa-telegram-config';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export function loadTelegramConfig(): TelegramConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveTelegramConfig(cfg: TelegramConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export async function sendTelegramMessage(text: string): Promise<boolean> {
  const cfg = loadTelegramConfig();
  if (!cfg) return false;

  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: 'HTML' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
