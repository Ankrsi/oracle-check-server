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

  let checks = 0;
  let found = 0;
  let notFound = 0;
  let lastStatus = "";

  while (Date.now() < stopAt) {
    checks++;
    const parts = [];
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
          parts.push(`${where}: ${s.availabilityStatus}`);
          if (ok) found++;
          else notFound++;
          if (ok && !wasAvailable[where]) {
            console.log(`\x07\n✅ AVAILABLE in ${where}\n`);
            const msg = `✅ ${SHAPE} ${OCPUS} OCPU / ${MEMORY_GB} GB AVAILABLE in ${where}. Launch it now!`;
            // On GitHub: fail the run on purpose, so GitHub emails you.
            if (process.env.GITHUB_ACTIONS) {
              console.error(`::error::${msg}`);
              process.exit(1);
            }
          }
          wasAvailable[where] = ok;
        }
      } catch (err) {
        parts.push(`${ad}: Error ${err.message}`);
      }
    }

    // Show only the latest status
    const status = parts.join(" | ");
    if (process.stdout.isTTY) {
      // Terminal: overwrite the same line
      process.stdout.write(`\r\x1b[K[${time()}] #${checks}  ${status}  | Found: ${found}  Not found: ${notFound}`);
    } else if (status !== lastStatus) {
      // GitHub log: print only when the status changes
      console.log(`[${time()}] ${status}`);
    }
    lastStatus = status;
    await sleep(INTERVAL_MS);
  }
  console.log(`\nTime limit reached. Checks: ${checks}  Found: ${found}  Not found: ${notFound}`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
