import { useChatStore } from '../../stores/chatStore';
import { MessageList } from '../chat/MessageList';
import { MessageInput } from '../chat/MessageInput';
import { useWebSocket } from '../../hooks/useWebSocket';

export function ChatArea() {
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const channels = useChatStore((s) => s.channels);
  const { sendMessage, sendTyping, editMessage, deleteMessage } = useWebSocket();

  const activeChannel = channels.find((c) => c.id === activeChannelId);
  const canWrite = activeChannel?.my_role === 'admin' || activeChannel?.my_role === 'write';

  if (!activeChannelId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background text-default-400">
        <div className="text-center">
          <p className="text-2xl mb-2">Welcome to Isle Chat</p>
          <p>Select a channel or start a conversation</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background">
      <MessageList channelId={activeChannelId} onEditMessage={editMessage} onDeleteMessage={deleteMessage} />
      {canWrite ? (
        <MessageInput
          onSend={(content) => sendMessage(activeChannelId, content)}
          onTyping={() => sendTyping(activeChannelId)}
        />
      ) : (
        <div className="border-t border-default-100 p-4 text-center text-default-400 text-sm">
          You have read-only access to this channel
        </div>
      )}
    </div>
  );
}
