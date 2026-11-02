// Stands in for yourlore.dev's BidRail entrypoint in checkout's tests: it records what it was told.
import { WorkerEntrypoint } from "cloudflare:workers";

const told = [];

export class BidRail extends WorkerEntrypoint {
  cardSaved(bid, card) {
    told.push({ cardSaved: [bid, card] });
    return true;
  }

  paid(bid, payment) {
    told.push({ paid: [bid, payment] });
    return !told.slice(0, -1).some((t) => t.paid?.[0] === bid);
  }

  told() {
    return told;
  }

  forget() {
    told.length = 0;
  }
}

export default { fetch: () => new Response("fake site") };
