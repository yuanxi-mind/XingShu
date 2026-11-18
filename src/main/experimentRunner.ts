/** Runs only on a user-selected server. Model code executes inside a restricted Docker container. */
export const EXPERIMENT_RUNNER = String.raw`#!/usr/bin/env python3
import argparse, hashlib, json, os, pathlib, shutil, signal, statistics, subprocess, sys, time

ROOT = pathlib.Path(__file__).resolve().parent
VERSION = 'xingshu-experiment-v1'
TRAIN_WRAPPER = "import subprocess,sys\ntry:\n p=subprocess.run([sys.executable]+sys.argv[2:],timeout=int(sys.argv[1])); sys.exit(p.returncode)\nexcept subprocess.TimeoutExpired:\n print('Training time limit exceeded',file=sys.stderr); sys.exit(124)"

def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1048576), b''): h.update(block)
    return h.hexdigest()

def within(root, name):
    path = root / name
    if any(p.is_symlink() for p in [path] + list(path.parents) if p != root.parent) or root.resolve() not in path.resolve().parents:
        raise ValueError('Path outside approved workspace: ' + name)
    return path

def atomic(path, value):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(tmp, path)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--dataset-root', default='')
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    if sha(ROOT / 'manifest.json') != args.manifest_sha256: raise ValueError('Manifest changed')
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    actual = {'experiment.json', 'run_experiment.py'} | {p.relative_to(ROOT).as_posix() for p in (ROOT / 'code').rglob('*') if p.is_file()}
    if actual != set(manifest['files']): raise ValueError('Input inventory changed')
    for name, expected in manifest['files'].items():
        path = within(ROOT, name)
        if not path.is_file() or sha(path) != expected: raise ValueError('File changed: ' + name)
    plan = json.loads((ROOT / 'experiment.json').read_text(encoding='utf-8'))
    if args.check_only:
        print(json.dumps({'checked': True, 'codeHash': manifest['codeHash'], 'manifestHash': args.manifest_sha256})); return
    results = ROOT / 'results'; results.mkdir(exist_ok=True)
    lock = ROOT / '.runner-lock'
    try: lock.mkdir()
    except FileExistsError: raise RuntimeError('This bundle was already started; do not launch twice')
    state = {'runner': VERSION, 'bundleId': manifest['bundleId'], 'manifestHash': args.manifest_sha256,
             'codeHash': manifest['codeHash'], 'plan': plan, 'startedAt': time.time(), 'status': 'running', 'runs': []}
    state_file = results / 'bundle-results.json'
    atomic(state_file, state)
    active = {'container': None}
    def stop(_signum, _frame):
        if active['container']:
            subprocess.run(['docker', 'stop', '--time', '5', active['container']], timeout=15, capture_output=True)
        state['status'] = 'cancelled'; atomic(state_file, state); sys.exit(130)
    signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGINT, stop)
    try:
        image = subprocess.run(['docker', 'image', 'inspect', plan['image'], '--format', '{{json .RepoDigests}}'], check=True, capture_output=True, text=True, timeout=20)
        state['imageInspection'] = image.stdout.strip()
        for seed in plan['seeds']:
            directory = results / ('seed-' + str(seed)); directory.mkdir()
            work = ROOT / 'workspaces' / ('seed-' + str(seed))
            shutil.copytree(ROOT / 'code', work, symlinks=False)
            metrics = within(work, plan['metricPath'])
            if metrics.exists(): metrics.unlink()
            container = 'xingshu-' + manifest['bundleId'][-12:] + '-' + str(seed)
            active['container'] = container
            command = ['docker', 'run', '--rm', '--pull=never', '--name', container, '--network', 'none', '--read-only',
                       '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '512',
                       '--cpus', str(plan['cpus']), '--memory', str(plan['memoryGb']) + 'g',
                       '--user', str(os.getuid()) + ':' + str(os.getgid()), '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m',
                       '--workdir', '/workspace', '--env', 'RESEARCH_SEED=' + str(seed),
                       '--mount', 'type=bind,src=' + str(work) + ',dst=/workspace']
            if args.dataset_root:
                dataset = pathlib.Path(args.dataset_root).resolve(strict=True)
                if not dataset.is_dir() or ',' in str(dataset): raise ValueError('Invalid dataset directory')
                command += ['--mount', 'type=bind,src=' + str(dataset) + ',dst=/datasets,readonly']
            if plan['gpuDevices']: command += ['--gpus', '"device=' + plan['gpuDevices'] + '"']
            # The in-container timer survives losing the host runner or its SSH connection.
            command += [plan['image'], 'python', '-c', TRAIN_WRAPPER, str(plan['timeoutSeconds']), plan['entrypoint']] + plan['args']
            if plan['seedFlag']: command += [plan['seedFlag'], str(seed)]
            started = time.time(); log = directory / 'train.log'; timed_out = False
            with open(log, 'wb') as stream:
                try: outcome = subprocess.run(command, stdout=stream, stderr=subprocess.STDOUT, timeout=plan['timeoutSeconds'])
                except subprocess.TimeoutExpired:
                    timed_out = True
                    subprocess.run(['docker', 'stop', '--time', '5', container], timeout=15, capture_output=True)
                    outcome = None
            active['container'] = None
            # Bound collection size while explicitly recording that the full server log was truncated.
            full_size = log.stat().st_size
            if full_size > 1048576:
                with open(log, 'rb') as f: f.seek(-1048576, 2); tail = f.read()
                log.write_bytes(b'[Only final 1 MiB retained for collection]\n' + tail)
            item = {'seed': seed, 'exitCode': outcome.returncode if outcome else None, 'timeout': timed_out,
                    'durationSeconds': time.time() - started, 'command': command,
                    'log': 'results/seed-' + str(seed) + '/train.log', 'logHash': sha(log), 'originalLogBytes': full_size}
            metrics = within(work, plan['metricPath'])
            if outcome and outcome.returncode == 0 and metrics.is_file() and metrics.stat().st_size <= 1048576:
                obj = json.loads(metrics.read_text(encoding='utf-8')); value = obj.get(plan['metricName'])
                if isinstance(value, (int, float)) and not isinstance(value, bool) and float('-inf') < value < float('inf'):
                    saved = directory / 'metrics.json'; shutil.copyfile(metrics, saved)
                    item.update(metric=value, metrics='results/seed-' + str(seed) + '/metrics.json', metricsHash=sha(saved))
            state['runs'].append(item); atomic(state_file, state)
        values = [r['metric'] for r in state['runs'] if 'metric' in r]
        state['status'] = 'completed' if len(values) == len(plan['seeds']) else 'failed'
        state['mean'] = statistics.mean(values) if values else None
        state['standardDeviation'] = statistics.stdev(values) if len(values) > 1 else None
    except Exception as error:
        state['status'] = 'failed'; state['error'] = str(error)
    finally:
        state['finishedAt'] = time.time(); atomic(state_file, state)
    if state['status'] != 'completed': sys.exit(1)

if __name__ == '__main__': main()
`;
