const { spawn } = require('child_process');

// Run an executable with an argv array (no shell). Returns {stdout, stderr}
// on exit 0; rejects with an Error that carries .stdout/.stderr/.code on any
// non-zero exit, spawn failure, or timeout. Keeps argv strictly separated from
// the command string so user-supplied values cannot be interpreted as shell
// metacharacters.
function runCmd(file, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const proc = spawn(file, args, { windowsHide: true });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('error', (err) => {
      clearTimeout(timer);
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        const err = new Error(`Command timed out after ${timeoutMs}ms`);
        err.stdout = stdout;
        err.stderr = stderr;
        err.code = code;
        reject(err);
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const err = new Error(stderr.trim() || `Process exited with code ${code}`);
        err.stdout = stdout;
        err.stderr = stderr;
        err.code = code;
        reject(err);
      }
    });
  });
}

module.exports = { runCmd };
