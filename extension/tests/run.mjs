// run.mjs — runner Node: jalankan seluruh suite, print hasil, exit code benar.
import { tests } from './suite.js';

let pass = 0;
let fail = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    pass++;
    console.log('  PASS ' + name);
  } catch (e) {
    fail++;
    console.error('  FAIL ' + name + '\n    ' + (e && e.message));
  }
}
console.log('\n' + pass + ' pass, ' + fail + ' fail, total ' + tests.length);
process.exit(fail ? 1 : 0);
