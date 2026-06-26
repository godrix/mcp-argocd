export interface ParsedLogLine {
  podName?: string;
  timeStamp?: string;
  content?: string;
}

interface ArgoCdLogEntry {
  content?: string;
  podName?: string;
  timeStampStr?: string;
  timeStamp?: { seconds?: string };
}

interface ArgoCdLogStreamLine {
  result?: ArgoCdLogEntry;
  content?: string;
  podName?: string;
  timeStampStr?: string;
  timeStamp?: { seconds?: string };
}

function normalizeLogEntry(entry: ArgoCdLogEntry): ParsedLogLine {
  return {
    content: entry.content,
    podName: entry.podName,
    timeStamp: entry.timeStampStr ?? entry.timeStamp?.seconds,
  };
}

export function parseLogStream(raw: string): ParsedLogLine[] {
  const lines: ParsedLogLine[] = [];

  for (const chunk of raw.split("\n")) {
    const trimmed = chunk.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as ArgoCdLogStreamLine;
      const entry = parsed.result ?? parsed;
      lines.push(normalizeLogEntry(entry));
    } catch {
      lines.push({ content: trimmed });
    }
  }

  return lines;
}
