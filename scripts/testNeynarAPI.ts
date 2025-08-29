import ky from "ky";

interface NeynarCast {
  hash: string;
  author: {
    fid: number;
    username: string;
  };
  text: string;
  timestamp: string;
  reactions: {
    likes_count: number;
    recasts_count: number;
  };
}

interface NeynarResponse {
  casts: NeynarCast[];
  next_cursor?: string;
}

async function testNeynarAPI() {
  console.log("🧪 Testing Neynar API Integration...");

  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) {
    console.error("❌ NEYNAR_API_KEY not set in environment");
    return;
  }

  // Test with some popular FIDs
  const testFids = [3, 5650, 1689]; // vitalik.eth, dwr.eth, and another user
  const fidString = testFids.join(',');

  try {
    console.log(`🔍 Fetching casts for FIDs: ${fidString}`);

    const response = await ky.get('https://api.neynar.com/v2/farcaster/feed/', {
      headers: {
        'x-api-key': apiKey,
        'x-neynar-experimental': 'false'
      },
      searchParams: {
        feed_type: 'filter',
        filter_type: 'fids',
        fids: fidString,
        with_recasts: 'true',
        limit: '10' // Small limit for testing
      },
      timeout: 30000
    }).json<NeynarResponse>();

    console.log("✅ API call successful!");
    console.log(`📊 Retrieved ${response.casts.length} casts`);

    if (response.next_cursor) {
      console.log(`🔄 Next cursor available: ${response.next_cursor.substring(0, 20)}...`);
    }

    // Process and filter casts for "gm" content
    let gmCasts = 0;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    console.log("\n🔍 Processing casts for 'gm' content:");

    response.casts.forEach((cast, index) => {
      const castDate = new Date(cast.timestamp);
      const isYesterday = castDate >= yesterday && castDate < today;
      const hasGm = cast.text.toLowerCase().includes('gm');

      console.log(`\n📝 Cast ${index + 1}:`);
      console.log(`   Author: @${cast.author.username} (FID: ${cast.author.fid})`);
      console.log(`   Content: ${cast.text.substring(0, 100)}${cast.text.length > 100 ? '...' : ''}`);
      console.log(`   Timestamp: ${cast.timestamp} (Yesterday: ${isYesterday})`);
      console.log(`   Likes: ${cast.reactions.likes_count}, Recasts: ${cast.reactions.recasts_count}`);
      console.log(`   Contains 'gm': ${hasGm}`);

      if (hasGm && isYesterday) {
        gmCasts++;
        console.log(`   ✅ QUALIFIES for GM rewards!`);
      }
    });

    console.log(`\n📈 Summary:`);
    console.log(`   Total casts: ${response.casts.length}`);
    console.log(`   GM casts from yesterday: ${gmCasts}`);

    // Test keyword detection
    console.log("\n🔤 Testing keyword detection:");
    const testTexts = [
      "gm everyone!",
      "Good morning! #gm",
      "$gm to the moon!",
      "GM fam 🌅",
      "saying gm, what's up?",
      "no morning greeting here"
    ];

    testTexts.forEach(text => {
      const keyword = findKeywordWithPrefix(text);
      console.log(`   "${text}" -> "${keyword}"`);
    });

  } catch (error: any) {
    console.error("❌ API test failed:", error);
    if (error.response) {
      console.error("Response status:", error.response.status);
      const errorBody = await error.response.text();
      console.error("Error body:", errorBody);
    }
  }
}

function findKeywordWithPrefix(text: string): string {
  const words = text.split(/\s+/);
  const KEYWORD = "gm";

  let foundWord = "";
  for (const word of words) {
    const cleanedWord = word.replace(/[.,!?;:()]/g, "").toLowerCase();

    if (cleanedWord === "$" + KEYWORD) {
      return "$" + KEYWORD;
    }
    else if (cleanedWord === "#" + KEYWORD) {
      foundWord = "#gm";
    }
    else if (cleanedWord === KEYWORD && foundWord == "") {
      foundWord = cleanedWord;
    }
  }

  return foundWord;
}

// Run the test
testNeynarAPI()
  .then(() => console.log("\n🎉 Test completed!"))
  .catch(console.error);