# Sponsor Screencast Voiceover

## 0G

First, the finished render and JSON metadata enter the same 0G upload path. Live mode uses the 0G SDK, indexer, and serialized upload transaction. Then finalization turns those roots into iNFT metadata. On staging, the iNFT page shows the video root, metadata root, and URI.

## KeeperHub

KeeperHub starts in the quote path: when payment and settlement tokens differ, SuperReferrals creates a KeeperHub payment intent. The client collects that wallet payment and waits for confirmation. The backend then sends settlement events, and failed or cancelled work can trigger KeeperHub refunds. Staging shows that payment-and-refund story.

## ENS

ENS begins with resolver reads for the wallet, avatar, and SuperReferrals text records. The dashboard writes the storefront proxy records through an ENS resolver multicall. Finally, the storefront directory renders the verified owner ENS badge. The staging directory is the user-facing surface for that identity.
