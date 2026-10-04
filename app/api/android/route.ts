import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';

const execPromise = util.promisify(exec);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ADB_BIN = process.platform === 'win32' && fs.existsSync('C:\\platform-tools\\adb.exe') ? 'C:\\platform-tools\\adb' : 'adb';
const execADB = (cmd: string, opts?: any) => execPromise(cmd.replace(/C:\\platform-tools\\adb/g, ADB_BIN), opts);

export async function POST(request: Request) {
  try {
    const { cmd, args } = await request.json();
    let adbCommand = '';

    switch (cmd) {
      case 'pressHome':
        adbCommand = 'C:\\platform-tools\\adb shell input keyevent 3';
        break;
      case 'goBack':
        adbCommand = 'C:\\platform-tools\\adb shell input keyevent 4';
        break;
      case 'swipe':
        const dir = args?.direction || 'up';
        // Basic swipe logic (assuming 1080x2400 screen, generic coordinates)
        if (dir === 'up') adbCommand = 'C:\\platform-tools\\adb shell input swipe 500 1500 500 500';
        else if (dir === 'down') adbCommand = 'C:\\platform-tools\\adb shell input swipe 500 500 500 1500';
        else if (dir === 'left') adbCommand = 'C:\\platform-tools\\adb shell input swipe 800 1000 200 1000';
        else if (dir === 'right') adbCommand = 'C:\\platform-tools\\adb shell input swipe 200 1000 800 1000';
        break;
      case 'tapScreen':
        if (args?.x !== undefined && args?.y !== undefined) {
          const tapX = Math.round(Number(args.x) * 2);
          const tapY = Math.round(Number(args.y) * 2);
          adbCommand = `C:\\platform-tools\\adb shell input tap ${tapX} ${tapY}`;
        } else {
          return NextResponse.json({ success: false, error: 'Missing x or y for tapScreen' }, { status: 400 });
        }
        break;
      case 'unlockPhone':
        console.log(`Executing Unlock Phone Sequence...`);
        // KEYCODE_WAKEUP (224) wakes screen without turning it off if already on
        await execADB('C:\\platform-tools\\adb shell input keyevent 224');
        await sleep(1000);
        // Swipe up to dismiss lock screen or reveal PIN pad
        await execADB('C:\\platform-tools\\adb shell input swipe 500 2000 500 500');
        await sleep(1000);
        if (args?.pin) {
          await execADB(`C:\\platform-tools\\adb shell input text "${args.pin}"`);
          await sleep(500);
          await execADB('C:\\platform-tools\\adb shell input keyevent 66'); // Enter
        }
        return NextResponse.json({ success: true, stdout: "Phone unlocked sequence executed", stderr: "" });
      case 'searchYouTube':
        console.log(`Executing YouTube Search...`);
        // Press Back once to close any existing search/keyboard to ensure a fresh search
        await execADB('C:\\platform-tools\\adb shell input keyevent 4');
        await sleep(500);
        const ytSearchQuery = (args?.query || '').replace(/ /g, '\\ ');
        adbCommand = `C:\\platform-tools\\adb shell am start -a android.intent.action.SEARCH -p com.google.android.youtube -e query ${ytSearchQuery}`;
        break;
      case 'playYouTubeVideo':
        console.log(`Executing Play YouTube Video Sequence...`);
        await execADB('C:\\platform-tools\\adb shell input keyevent 4');
        await sleep(500);
        const ytPlayQuery = (args?.query || '').replace(/ /g, '\\ ');
        await execADB(`C:\\platform-tools\\adb shell am start -a android.intent.action.SEARCH -p com.google.android.youtube -e query ${ytPlayQuery}`);
        await sleep(2500); // Wait for YouTube to load results
        await execADB('C:\\platform-tools\\adb shell input tap 500 500'); // Tap on the first video result
        return NextResponse.json({ success: true, stdout: "YouTube video play sequence executed", stderr: "" });
      case 'searchOnGoogle':
        const googleQuery = (args?.query || '').replace(/ /g, '\\ ');
        adbCommand = `C:\\platform-tools\\adb shell am start -a android.intent.action.WEB_SEARCH -e query ${googleQuery}`;
        break;
      case 'typeText':
        // Replace spaces with %s for ADB input text
        const text = (args?.text || '').replace(/ /g, '%s');
        adbCommand = `C:\\platform-tools\\adb shell input text "${text}"`;
        break;
      case 'clearText':
        // Press backspace 50 times to ensure text is cleared
        adbCommand = `C:\\platform-tools\\adb shell input keyevent ` + Array(50).fill('67').join(' ');
        break;
      case 'pressEnter':
        adbCommand = 'C:\\platform-tools\\adb shell input keyevent 66';
        break;
      case 'sendWhatsAppMessage':
        console.log(`Executing WhatsApp Sequence...`);
        await execADB('C:\\platform-tools\\adb shell am start -n com.whatsapp/.Main');
        await sleep(1000);
        await execADB('C:\\platform-tools\\adb shell input keyevent 84'); // Search
        await sleep(500);
        const contact = (args?.contactName || '').replace(/ /g, '%s');
        await execADB(`C:\\platform-tools\\adb shell input text "${contact}"`);
        await sleep(1500);
        await execADB('C:\\platform-tools\\adb shell input tap 500 400'); // Tap first result
        await sleep(1000);
        const msg = (args?.message || '').replace(/ /g, '%s');
        await execADB(`C:\\platform-tools\\adb shell input text "${msg}"`);
        await sleep(500);
        await execADB('C:\\platform-tools\\adb shell input tap 980 1420'); // Tap send (approximate coordinates for typical phones)
        return NextResponse.json({ success: true, stdout: "Message sent sequence executed", stderr: "" });
      case 'openApp':
        const appName = (args?.appName || '').toLowerCase().trim();
        let pkg = '';
        if (appName.includes('youtube')) pkg = 'com.google.android.youtube';
        else if (appName.includes('whatsapp')) pkg = 'com.whatsapp';
        else if (appName.includes('chrome')) pkg = 'com.android.chrome';
        else if (appName.includes('instagram')) pkg = 'com.instagram.android';
        else if (appName.includes('facebook')) pkg = 'com.facebook.katana';
        else if (appName.includes('map')) pkg = 'com.google.android.apps.maps';
        else if (appName.includes('spotify')) pkg = 'com.spotify.music';
        else if (appName.includes('settings')) pkg = 'com.android.settings';
        else if (appName.includes('snapchat')) pkg = 'com.snapchat.android';
        else if (appName.includes('telegram')) pkg = 'org.telegram.messenger';
        else if (appName.includes('netflix')) pkg = 'com.netflix.mediaclient';
        else if (appName.includes('amazon')) pkg = 'in.amazon.mShop.android.shopping';
        else if (appName.includes('flipkart')) pkg = 'com.flipkart.android';
        else if (appName.includes('x') || appName.includes('twitter')) pkg = 'com.twitter.android';
        else if (appName.includes('phonepe')) pkg = 'com.phonepe.app';
        else if (appName.includes('gpay') || appName.includes('google pay')) pkg = 'com.google.android.apps.nbu.paisa.user';
        else if (appName.includes('paytm')) pkg = 'net.one97.paytm';
        
        if (!pkg) {
          try {
            const { stdout } = await execADB('C:\\platform-tools\\adb shell pm list packages');
            const packages = stdout.split('\n').map((l: string) => l.replace('package:', '').trim());
            const searchName = appName.replace(/\s+/g, '');
            pkg = packages.find((p: string) => p.toLowerCase().includes(searchName)) || '';
          } catch(e) {
            console.warn("Failed to list packages dynamically", e);
          }
        }

        if (pkg) {
          try {
            await execADB(`C:\\platform-tools\\adb shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
            return NextResponse.json({ success: true, stdout: "App launched via monkey", stderr: "" });
          } catch (e) {
            console.warn(`Monkey failed to launch ${pkg}. Falling back to Play Store.`);
            adbCommand = `C:\\platform-tools\\adb shell am start -a android.intent.action.VIEW -p com.android.vending -d "market://search?q=${encodeURIComponent(appName)}"`;
          }
        } else {
          // Fallback if package not found anywhere, try Google Play Store explicitly
          adbCommand = `C:\\platform-tools\\adb shell am start -a android.intent.action.VIEW -p com.android.vending -d "market://search?q=${encodeURIComponent(appName)}"`;
        }
        break;
      default:
        return NextResponse.json({ success: false, error: 'Unknown command: ' + cmd }, { status: 400 });
    }

    if (adbCommand) {
      console.log(`Executing ADB Command: ${adbCommand}`);
      const { stdout, stderr } = await execADB(adbCommand);
      return NextResponse.json({ success: true, stdout, stderr });
    }
    
    return NextResponse.json({ success: true, message: "No ADB command executed (empty)" });
  } catch (error: any) {
    console.error('ADB Execution Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
