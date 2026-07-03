/** Interactive secret input — never via argv, never echoed. */

/** Read one line from stdin with echo disabled (TTY) or piped input. */
export function promptHidden(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stderr } = process;

    if (!stdin.isTTY) {
      // Piped input (e.g. `echo "$SECRET" | surfgen auth use-key --stdin`).
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (chunk) => (data += chunk));
      stdin.on('end', () => resolve(data.split('\n')[0]?.trim() ?? ''));
      stdin.on('error', reject);
      return;
    }

    stderr.write(`${label}: `);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    const onData = (char: string) => {
      switch (char) {
        case '\n':
        case '\r':
        case '': // Ctrl-D
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          stderr.write('\n');
          resolve(value);
          break;
        case '': // Ctrl-C
          stdin.setRawMode(false);
          stdin.pause();
          stderr.write('\n');
          reject(new Error('cancelled'));
          break;
        case '': // backspace
          value = value.slice(0, -1);
          break;
        default:
          value += char;
      }
    };
    stdin.on('data', onData);
  });
}
