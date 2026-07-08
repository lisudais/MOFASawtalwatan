const STORAGE_KEY = 'mfa-ntfy-topic';

export function loadNtfyTopic(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function saveNtfyTopic(topic: string): void {
  localStorage.setItem(STORAGE_KEY, topic);
}

export async function sendNtfyNotification(title: string, message: string, priority: 'default' | 'high' | 'urgent' = 'default'): Promise<boolean> {
  const topic = loadNtfyTopic();
  if (!topic) return false;

  try {
    const res = await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: {
        Title: title,
        Priority: priority,
      },
      body: message,
    });
    return res.ok;
  } catch {
    return false;
  }
}
