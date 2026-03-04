import { useState, useRef, useCallback } from 'react';
import { Textarea, Button } from '@heroui/react';

interface Props {
  onSend: (content: string) => void;
  onTyping: () => void;
}

export function MessageInput({ onSend, onTyping }: Props) {
  const [content, setContent] = useState('');
  const lastTyping = useRef(0);

  const handleChange = useCallback(
    (value: string) => {
      setContent(value);
      const now = Date.now();
      if (now - lastTyping.current > 2000) {
        lastTyping.current = now;
        onTyping();
      }
    },
    [onTyping]
  );

  const handleSubmit = () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setContent('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-default-100 p-2 sm:p-4">
      <div className="flex gap-2 items-end">
        <Textarea
          value={content}
          onValueChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          minRows={1}
          maxRows={4}
          variant="bordered"
          className="flex-1"
        />
        <Button
          color="primary"
          isDisabled={!content.trim()}
          onPress={handleSubmit}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
