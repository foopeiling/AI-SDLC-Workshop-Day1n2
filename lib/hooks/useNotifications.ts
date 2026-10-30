'use client';

import { useEffect, useRef, useState } from 'react';
import type { Todo } from '@/lib/db';
import { formatSingaporeDateTime, getSingaporeNow } from '@/lib/timezone';

type NotificationPermissionState = NotificationPermission | 'unsupported';

interface DueReminderResponse {
  data?: Array<Pick<Todo, 'id' | 'title' | 'due_date' | 'reminder_minutes'>>;
}

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermissionState>('default');
  const displayedReminders = useRef(new Set<string>());

  async function requestPermission() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return;
    }

    try {
      setPermission(await window.Notification.requestPermission());
    } catch {
      setPermission(window.Notification.permission);
    }
  }

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setPermission('Notification' in window ? window.Notification.permission : 'unsupported');
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (permission !== 'granted') return;

    let active = true;
    let polling = false;

    async function poll() {
      if (!active || polling) return;
      polling = true;

      if (window.Notification.permission !== 'granted') {
        setPermission(window.Notification.permission);
        polling = false;
        return;
      }

      try {
        const response = await fetch('/api/notifications/check', { cache: 'no-store' });
        if (!response.ok) return;
        const { data: dueTodos } = await response.json() as DueReminderResponse;

        for (const todo of dueTodos ?? []) {
          if (!active) break;
          if (!todo.due_date || todo.reminder_minutes === null) continue;
          if (window.Notification.permission !== 'granted') {
            setPermission(window.Notification.permission);
            break;
          }

          const reminderKey = `${todo.id}:${todo.due_date}:${todo.reminder_minutes}`;
          if (!displayedReminders.current.has(reminderKey)) {
            try {
              new window.Notification(todo.title, {
                body: todo.due_date ? `Due ${formatSingaporeDateTime(todo.due_date)}` : '',
                tag: `todo-${todo.id}`,
              });
              displayedReminders.current.add(reminderKey);
            } catch {
              continue;
            }
          }

          try {
            const stampResponse = await fetch(`/api/todos/${todo.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                last_notification_sent: getSingaporeNow().toISOString(),
                expected_due_date: todo.due_date,
                expected_reminder_minutes: todo.reminder_minutes,
              }),
            });
            if (stampResponse.ok || stampResponse.status === 409) {
              displayedReminders.current.delete(reminderKey);
            }
            if (!stampResponse.ok) continue;
          } catch {
            continue;
          }
        }
      } catch {
        return;
      } finally {
        polling = false;
      }
    }

    void poll();
    const intervalId = window.setInterval(() => void poll(), 30_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [permission]);

  return { permission, requestPermission };
}