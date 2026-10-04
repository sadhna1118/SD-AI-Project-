import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';

const execPromise = util.promisify(exec);
const ADB_BIN = process.platform === 'win32' && fs.existsSync('C:\\platform-tools\\adb.exe') ? 'C:\\platform-tools\\adb' : 'adb';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { stdout } = await execPromise(`${ADB_BIN} devices -l`);
    const lines = stdout.split('\n').filter(l => l.trim().length > 0);
    const devices = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(/\s+/);
      const id = parts[0];
      const state = parts[1];
      const modelMatch = line.match(/model:(\S+)/);
      const model = modelMatch ? modelMatch[1] : 'Android Device';
      devices.push({ id, state, model, raw: line });
    }

    const isConnected = devices.some(d => d.state === 'device');
    return NextResponse.json({
      success: true,
      connected: isConnected,
      devices,
      count: devices.length
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { action, ip, port, code } = await request.json();
    const targetIp = (ip && ip.trim()) ? ip.trim() : 'localhost';

    if (!port) {
      return NextResponse.json({ success: false, error: 'Port is required (e.g. 38475)' }, { status: 400 });
    }

    const endpoint = `${targetIp}:${port.toString().trim()}`;

    // Action 1: Pair with code
    if (action === 'pair') {
      if (!code) {
        return NextResponse.json({ success: false, error: '6-digit pairing code is required' }, { status: 400 });
      }
      const pairCmd = `${ADB_BIN} pair ${endpoint} ${code.toString().trim()}`;
      console.log(`Executing ADB Pair: ${pairCmd}`);
      const pairRes = await execPromise(pairCmd);

      // Auto-connect after pair if possible
      try {
        const connectRes = await execPromise(`${ADB_BIN} connect ${endpoint}`);
        return NextResponse.json({
          success: true,
          paired: true,
          connected: true,
          stdout: `${pairRes.stdout}\n${connectRes.stdout}`,
          message: 'Paired and Connected successfully!'
        });
      } catch {
        return NextResponse.json({
          success: true,
          paired: true,
          stdout: pairRes.stdout,
          message: 'Device paired successfully!'
        });
      }
    }

    // Action 2: Direct Connect
    const connectCmd = `${ADB_BIN} connect ${endpoint}`;
    console.log(`Executing ADB Connect: ${connectCmd}`);
    const { stdout, stderr } = await execPromise(connectCmd);

    const isConnected = stdout.toLowerCase().includes('connected to') && !stdout.toLowerCase().includes('failed');
    return NextResponse.json({
      success: isConnected || !stderr,
      connected: isConnected,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      message: isConnected ? `Connected to ${endpoint}!` : stdout.trim()
    });
  } catch (error: any) {
    console.error('ADB Connect Route Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
