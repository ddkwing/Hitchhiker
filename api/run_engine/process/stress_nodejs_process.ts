import { Setting } from '../../utils/setting';
import * as WS from 'ws';
import * as OS from 'os';
import * as path from 'path';
import { Log } from '../../utils/log';
import { StressMessage, TestCase, StressRequest } from '../../interfaces/dto_stress_setting';
import { WorkerStatus, StressMessageType } from '../../common/stress_type';
import { RunResult } from '../../interfaces/dto_run_result';
import { ChildProcessManager } from './child_process_manager';
import { MathUtil } from '../../utils/math_util';
import { StressNodejsRunnerHandler } from './stress_nodejs_runner_handler';
import { BaseProcessHandler } from './base_process_handler';

const restartDelay: number = 10 * 1000;

Log.init();

process.on('uncaughtException', (err) => {
    Log.error(err);
});

let ws = createWS();

let testCase: TestCase;

const processManager = ChildProcessManager.create('stress_nodejs_runner', { count: OS.cpus().length, entry: path.join(__dirname, '../stress_nodejs_runner.js'), handlerCtor: StressNodejsRunnerHandler });

runForHandlers((h, i) => h.call = handleChildProcessMsg);

function createWS(): WS {
    return new WS(Setting.instance.stressHost);
}

ws.on('open', function open() {
    Log.info('nodejs stress process: connect success');
    send(createMsg(WorkerStatus.idle, StressMessageType.hardware, null, OS.cpus().length));
});

ws.on('message', data => {
    Log.info(`nodejs stress process: receive case: ${data}`);
    const msg = JSON.parse(data.toString()) as StressRequest;
    handleMsg(msg);
});

ws.on('close', (code, msg) => {
    Log.error(`nodejs stress process: close ${code}: ${msg}`);
    setTimeout(() => ws = createWS(), restartDelay);
});

function send(msg: StressMessage) {
    Log.info(`nodejs stress process: send message with type ${msg.type} and status: ${msg.status}`);
    ws.send(msg);
}

function handleMsg(msg: StressRequest) {
    switch (msg.type) {
        case StressMessageType.task:
            testCase = msg.testCase;
            send(createMsg(WorkerStatus.ready, StressMessageType.status));
            Log.info('status: ready');
            break;
        case StressMessageType.start:
            Log.info('status: start');
            send(createMsg(WorkerStatus.working, StressMessageType.status));
            run();
            break;
        case StressMessageType.finish:
            Log.info('status: file finish');
            finish();
            break;
        case StressMessageType.stop:
            finish();
            break;
        default:
            break;
    }
}

function handleChildProcessMsg(data: any) {
    if (data === 'ready') { }
    else if (data === 'finish' || data === 'error') {
        let isAllFinish = true;
        runForHandlers((h, i) => isAllFinish = isAllFinish && (h as StressNodejsRunnerHandler).isFinish);
        if (isAllFinish) {
            finish();
        }
    } else {
        trace(JSON.parse(data));
    }
}

function runForHandlers(call: (h: BaseProcessHandler, i: number) => void) {
    const handler = processManager.getHandler('stress_nodejs_runner');
    if (handler instanceof Array) {
        handler.forEach(call);
    } else {
        call(handler, 0);
    }
}

function run() {
    processManager.init();
    const taskForProcessArr = MathUtil.distribute(testCase.concurrencyCount, OS.cpus().length);
    const handler = processManager.getHandler('stress_nodejs_runner');
    runForHandlers((h, i) => {
        h.process.send({
            type: StressMessageType.task,
            testCase: { ...testCase, concurrencyCount: taskForProcessArr[i] }
        });
    });
}

function finish() {
    send(createMsg(WorkerStatus.finish, StressMessageType.status));
    processManager.closeAll();
}

function trace(rst: RunResult) {
    send(createMsg(WorkerStatus.working, StressMessageType.runResult, rst));
}

function createMsg(status: WorkerStatus, type: StressMessageType, runResult: RunResult = null, cpuNum: number = 0): StressMessage {
    return { status, type, runResult, cpuNum };
}