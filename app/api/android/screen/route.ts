import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';

const execPromise = util.promisify(exec);
const ADB_BIN = process.platform === 'win32' && fs.existsSync('C:\\platform-tools\\adb.exe') ? 'C:\\platform-tools\\adb' : 'adb';

export const dynamic = 'force-dynamic'; // Prevent caching

export async function GET(): Promise<NextResponse> {
  try {
    const { stdout } = await execPromise(`${ADB_BIN} exec-out screencap -p`, {
      encoding: 'buffer',
      maxBuffer: 1024 * 1024 * 10,
    });
    const base64Image = (stdout as unknown as Buffer).toString('base64');
    return NextResponse.json({ success: true, base64: base64Image });
  } catch (error: any) {
    console.error('Screen Capture Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

