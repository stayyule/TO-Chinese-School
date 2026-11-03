import { execFileSync } from 'child_process';
import * as path from 'path';

// The flat config is ESM; jest (CommonJS) cannot dynamic-import it, so lint in a child process.
const root = path.resolve(__dirname, '..');
const script = `
const { ESLint } = require('eslint');
(async () => {
  const code = "parseFloat('1');\\n(1).toFixed(2);\\n";
  const root = ${JSON.stringify(root)};
  const eslint = new ESLint({ cwd: root });
  const out = {};
  for (const f of ['src/common/other.ts', 'src/common/cents.ts']) {
    const [r] = await eslint.lintText(code, { filePath: root + '/' + f });
    out[f] = r.messages.filter((m) => m.ruleId === 'no-restricted-syntax').length;
  }
  console.log(JSON.stringify(out));
})();
`;

describe('eslint money restrictions', () => {
  const counts: Record<string, number> = JSON.parse(
    execFileSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8' }),
  );

  it('bans parseFloat and toFixed outside cents.ts', () => {
    expect(counts['src/common/other.ts']).toBe(2);
  });

  it('allows them inside src/common/cents.ts', () => {
    expect(counts['src/common/cents.ts']).toBe(0);
  });
});
