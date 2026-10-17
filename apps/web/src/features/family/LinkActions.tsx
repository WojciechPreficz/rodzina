import { Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { useState } from 'react';
import { labels } from '../../i18n/pl.js';
import { isAndroid } from '../../platform.js';
import { registerPlugin } from '@capacitor/core';

const nativeLinks = registerPlugin<{
  copy(options: { url: string }): Promise<void>;
  share(options: { url: string; title: string }): Promise<void>;
}>('RodzinaLinks');

async function shareLink(url: string, title: string): Promise<void> {
  if (isAndroid()) return nativeLinks.share({ url, title });
  try {
    await navigator.share({ title, url });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return;
    }
    throw error;
  }
}

export function LinkActions({ link, shareTitle }: { link: string; shareTitle: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const canShare = isAndroid() || typeof navigator.share === 'function';

  const onCopy = async () => {
    try {
      if (isAndroid()) await nativeLinks.copy({ url: link });
      else await navigator.clipboard.writeText(link);
      setStatus('copied');
    } catch {
      setStatus('error');
    }
  };

  const onShare = async () => {
    try {
      await shareLink(link, shareTitle);
    } catch {
      setStatus('error');
    }
  };

  return (
    <Stack gap="xs">
      <TextInput readOnly value={link} aria-label={labels.link} onFocus={(event) => event.currentTarget.select()} />
      <Group gap="xs">
        <Button variant="light" onClick={onCopy}>
          {status === 'copied' ? labels.copied : labels.copy}
        </Button>
        {canShare ? (
          <Button variant="light" onClick={onShare}>
            {labels.share}
          </Button>
        ) : null}
      </Group>
      {status === 'error' ? (
        <Text size="sm" c="red">
          {labels.copyError}
        </Text>
      ) : null}
    </Stack>
  );
}
