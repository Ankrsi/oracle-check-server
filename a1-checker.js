// Checks every 3 seconds if Oracle Cloud has capacity for VM.Standard.A1.Flex.
// Locally: uses ~/.oci/config. On GitHub Actions: uses OCI_* secrets (see README).
// Run: node a1-checker.js

const common = require("oci-common");
const core = require("oci-core");
const identity = require("oci-identity");

const SHAPE = "VM.Standard.A1.Flex";
const OCPUS = 4;
const MEMORY_GB = 24;
const INTERVAL_MS = 3000;
const REGIONS = ["ap-hyderabad-1", "ap-mumbai-1"]; // all Indian regions
const MAX_MINUTES = Number(process.env.MAX_MINUTES || 0); // 0 = run forever

common.CircuitBreaker.EnableGlobalCircuitBreaker = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const time = () => new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });

function getProvider() {
  const e = process.env;
  if (e.OCI_PRIVATE_KEY) {
    return new common.SimpleAuthenticationDetailsProvider(
      e.OCI_TENANCY, e.OCI_USER, e.OCI_FINGERPRINT, e.OCI_PRIVATE_KEY, null,
      common.Region.fromRegionId(e.OCI_REGION || REGIONS[0])
    );
  }
  return new common.ConfigFileAuthenticationDetailsProvider();
}

async function telegram(text) {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat } = process.env;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text }),
    });
  } catch (err) {
    console.log(`Telegram failed: ${err.message}`);
  }
}

async function main() {
  const provider = getProvider();
  const compartmentId = provider.getTenantId();

  // Build a list of { compute client, AD } for every AD in every region
  const targets = [];
  for (const region of REGIONS) {
    try {
      const identityClient = new identity.IdentityClient({ authenticationDetailsProvider: provider });
      identityClient.regionId = region;
      const compute = new core.ComputeClient({ authenticationDetailsProvider: provider });
      compute.regionId = region;
      const ads = (await identityClient.listAvailabilityDomains({ compartmentId })).items;
      for (const a of ads) targets.push({ compute, ad: a.name });
    } catch (err) {
      console.log(`Skipping ${region}: ${err.message}`);
    }
  }
  if (!targets.length) throw new Error("No regions could be checked.");
  console.log(`Checking ${SHAPE} (${OCPUS} OCPU / ${MEMORY_GB} GB) in: ${targets.map((t) => t.ad).join(", ")}\n`);

  const stopAt = MAX_MINUTES ? Date.now() + MAX_MINUTES * 60000 : Infinity;
  const wasAvailable = {}; // only message once each time an AD becomes available

  while (Date.now() < stopAt) {
    for (const { compute, ad } of targets) {
      try {
        const resp = await compute.createComputeCapacityReport({
          createComputeCapacityReportDetails: {
            compartmentId,
            availabilityDomain: ad,
            shapeAvailabilities: [
              { instanceShape: SHAPE, instanceShapeConfig: { ocpus: OCPUS, memoryInGBs: MEMORY_GB } },
            ],
          },
        });
        for (const s of resp.computeCapacityReport.shapeAvailabilities) {
          const where = `${ad} ${s.faultDomain || ""}`.trim();
          const ok = s.availabilityStatus === "AVAILABLE";
          console.log(`[${time()}] ${where}: ${s.availabilityStatus}`);
          if (ok && !wasAvailable[where]) {
            console.log(`\x07\n✅ AVAILABLE in ${where}\n`);
            await telegram(`✅ ${SHAPE} ${OCPUS} OCPU / ${MEMORY_GB} GB AVAILABLE in ${where}. Launch it now!`);
          }
          wasAvailable[where] = ok;
        }
      } catch (err) {
        console.log(`[${time()}] Error: ${err.message}`);
      }
    }
    await sleep(INTERVAL_MS);
  }
  console.log("Time limit reached, stopping.");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
