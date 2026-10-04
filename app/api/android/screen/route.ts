import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';

const execPromise = util.promisify(exec);
const ADB_BIN = process.platform === 'win32' && fs.existsSync('C:\\platform-tools\\adb.exe') ? 'C:\\platform-tools\\adb' : 'adb';

export const dynamic = 'force-dynamic'; // Prevent caching

async function getFirstActiveDevice(): Promise<string | null> {
  try {
    const { stdout } = await execPromise(`${ADB_BIN} devices`);
    const lines = stdout.split('\n');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2 && parts[1] === 'device') {
        return parts[0];
      }
    }
  } catch {}
  return null;
}

export async function GET(): Promise<NextResponse> {
  try {
    const deviceId = await getFirstActiveDevice();
    if (!deviceId) {
      return NextResponse.json({ success: false, error: 'No active device connected' }, { status: 404 });
    }

    const { stdout } = await execPromise(`${ADB_BIN} -s ${deviceId} exec-out screencap -p`, {
      encoding: 'buffer',
      maxBuffer: 1024 * 1024 * 10,
    });
    const base64Image = (stdout as unknown as Buffer).toString('base64');
    return NextResponse.json({ success: true, base64: base64Image, deviceId });
  } catch (error: any) {
    console.error('Screen Capture Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

