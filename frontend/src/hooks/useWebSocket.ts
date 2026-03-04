import { useEffect, useRef, useCallback } from 'react';
import { wsService } from '../services/websocket';
import { useChatStore } from '../stores/chatStore';
import type { Message } from '../types';

export function useWebSocket() {
  const token = useChatStore((s) => s.token);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const addChannel = useChatStore((s) => s.addChannel);
  const updateChannel = useChatStore((s) => s.updateChannel);
  const removeChannel = useChatStore((s) => s.removeChannel);
  const setUserOnline = useChatStore((s) => s.setUserOnline);
  const setTyping = useChatStore((s) => s.setTyping);
  const clearTyping = useChatStore((s) => s.clearTyping);
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!token) return;

    wsService.connect(token);

    const unsubs = [
      wsService.on('new_message', (data: any) => {
        const msg: Message = data.message;
        addMessage(msg);
        clearTyping(msg.channel_id, msg.username);
      }),

      wsService.on('message_edited', (data: any) => {
        updateMessage(data.message);
      }),

      wsService.on('message_deleted', (data: any) => {
        updateMessage(data.message);
      }),

      wsService.on('channel_added', (data: any) => {
        addChannel(data.channel);
      }),

      wsService.on('user_online', (data: any) => {
        setUserOnline(data.user_id, true);
      }),

      wsService.on('user_offline', (data: any) => {
        setUserOnline(data.user_id, false);
      }),

      wsService.on('channel_removed', (data: any) => {
        removeChannel(data.channel_id);
      }),

      wsService.on('role_changed', (data: any) => {
        updateChannel({ id: data.channel_id, my_role: data.role });
      }),

      wsService.on('channel_updated', (data: any) => {
        updateChannel(data.channel);
      }),

      wsService.on('typing', (data: any) => {
        setTyping(data.channel_id, data.username);
        const key = `${data.channel_id}:${data.username}`;
        const existing = typingTimers.current.get(key);
        if (existing) clearTimeout(existing);
        typingTimers.current.set(
          key,
          setTimeout(() => clearTyping(data.channel_id, data.username), 3000)
        );
      }),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
      wsService.disconnect();
      typingTimers.current.forEach((t) => clearTimeout(t));
      typingTimers.current.clear();
    };
  }, [token]);

  const sendMessage = useCallback((channelId: string, content: string) => {
    wsService.send({ type: 'send_message', channel_id: channelId, content });
  }, []);

  const sendTyping = useCallback((channelId: string) => {
    wsService.send({ type: 'typing', channel_id: channelId });
  }, []);

  const editMessage = useCallback((messageId: string, content: string) => {
    wsService.send({ type: 'edit_message', message_id: messageId, content });
  }, []);

  const deleteMessage = useCallback((messageId: string) => {
    wsService.send({ type: 'delete_message', message_id: messageId });
  }, []);

  return { sendMessage, sendTyping, editMessage, deleteMessage };
}
