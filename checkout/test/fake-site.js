// Stands in for yourlore.dev's BidRail entrypoint in checkout's tests: it records what it was told.
// Its verdict follows the bid id: "pendingbid" isn't ready yet, "rejectedbd" isn't that bid's charge.
import { WorkerEntrypoint } from "cloudflare:workers";

const told = [];
const verdict = (bid, yes) => (bid === "pendingbid" ? "pending" : bid === "rejectedbd" ? "rejected" : yes);

export class BidRail extends WorkerEntrypoint {
  cardSaved(bid, card) {
    told.push({ cardSaved: [bid, card] });
    return true;
  }

  paid(bid, payment) {
    told.push({ paid: [bid, payment] });
    return verdict(bid, "filled");
  }

  failed(bid, failure) {
    told.push({ failed: [bid, failure] });
    return verdict(bid, "declined");
  }

  told() {
    return told;
  }

  forget() {
    told.length = 0;
  }
}

export default { fetch: () => new Response("fake site") };
