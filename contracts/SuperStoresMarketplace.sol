// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SuperStoresMarketplace is Ownable, ReentrancyGuard, ERC721Holder, ERC1155Holder {
    using SafeERC20 for IERC20;

    uint16 public constant BPS_DENOMINATOR = 10_000;

    enum TokenStandard {
        ERC721,
        ERC1155,
        INFT
    }

    enum SaleMechanism {
        FixedPrice,
        DutchAuction
    }

    struct Listing {
        address seller;
        address tokenContract;
        address paymentToken;
        uint256 tokenId;
        uint256 unitPrice;
        uint256 quantityAvailable;
        TokenStandard tokenStandard;
        SaleMechanism saleMechanism;
        uint256 startUnitPrice;
        uint64 startsAt;
        uint64 endsAt;
        bool acceptsOffers;
        bool active;
    }

    struct Offer {
        uint256 listingId;
        address bidder;
        address referrer;
        uint256 quantity;
        uint256 sellerAmount;
        uint256 platformFee;
        uint256 referrerFee;
        uint256 totalAmount;
        uint64 expiresAt;
        bool active;
    }

    struct SaleDistribution {
        uint256 sellerAmount;
        uint256 platformFee;
        uint256 referrerFee;
        uint256 total;
        address payableReferrer;
    }

    uint256 public nextListingId = 1;
    uint256 public nextOfferId = 1;
    address public platformTreasury;
    address public keeperHubExecutor;
    uint16 public platformFeeBps = 1_000;
    uint16 public referrerFeeBps = 1_000;
    uint16 public noReferrerPlatformFeeBps = 2_000;

    mapping(uint256 => Listing) public listings;
    mapping(uint256 => Offer) public offers;

    event ListingCreated(
        uint256 indexed listingId,
        address indexed seller,
        address indexed tokenContract,
        uint256 tokenId,
        TokenStandard tokenStandard,
        SaleMechanism saleMechanism,
        uint256 quantity,
        address paymentToken,
        uint256 unitPrice
    );
    event ListingCancelled(uint256 indexed listingId);
    event ListingOffersUpdated(uint256 indexed listingId, bool acceptsOffers);
    event ListingPurchased(
        uint256 indexed listingId,
        address indexed buyer,
        address indexed referrer,
        uint256 quantity,
        uint256 sellerAmount,
        uint256 platformFee,
        uint256 referrerFee,
        address paymentToken
    );
    event OfferCreated(
        uint256 indexed offerId,
        uint256 indexed listingId,
        address indexed bidder,
        address referrer,
        uint256 quantity,
        uint256 sellerAmount,
        uint256 platformFee,
        uint256 referrerFee,
        uint256 totalAmount,
        uint64 expiresAt
    );
    event OfferAccepted(uint256 indexed offerId, uint256 indexed listingId);
    event OfferCancelled(uint256 indexed offerId, uint256 indexed listingId);
    event KeeperHubExecutorUpdated(address indexed executor);
    event PlatformTreasuryUpdated(address indexed treasury);
    event FeeConfigUpdated(uint16 platformFeeBps, uint16 referrerFeeBps, uint16 noReferrerPlatformFeeBps);

    constructor(address initialOwner, address initialPlatformTreasury) Ownable(initialOwner) {
        require(initialPlatformTreasury != address(0), "treasury required");
        platformTreasury = initialPlatformTreasury;
    }

    function listERC721(
        address tokenContract,
        uint256 tokenId,
        address paymentToken,
        uint256 unitPrice
    ) external nonReentrant returns (uint256 listingId) {
        listingId = _createERC721LikeListing(
            tokenContract,
            tokenId,
            paymentToken,
            unitPrice,
            TokenStandard.ERC721,
            _fixedPriceTerms(unitPrice)
        );
    }

    function listINFT(
        address tokenContract,
        uint256 tokenId,
        address paymentToken,
        uint256 unitPrice
    ) external nonReentrant returns (uint256 listingId) {
        listingId = _createERC721LikeListing(
            tokenContract,
            tokenId,
            paymentToken,
            unitPrice,
            TokenStandard.INFT,
            _fixedPriceTerms(unitPrice)
        );
    }

    function listERC1155(
        address tokenContract,
        uint256 tokenId,
        uint256 quantity,
        address paymentToken,
        uint256 unitPrice
    ) external nonReentrant returns (uint256 listingId) {
        listingId = _createERC1155Listing(
            tokenContract,
            tokenId,
            quantity,
            paymentToken,
            unitPrice,
            _fixedPriceTerms(unitPrice)
        );
    }

    function listERC721DutchAuction(
        address tokenContract,
        uint256 tokenId,
        address paymentToken,
        uint256 startUnitPrice,
        uint256 endUnitPrice,
        uint64 startsAt,
        uint64 endsAt
    ) external nonReentrant returns (uint256 listingId) {
        listingId = _createERC721LikeListing(
            tokenContract,
            tokenId,
            paymentToken,
            endUnitPrice,
            TokenStandard.ERC721,
            _dutchAuctionTerms(startUnitPrice, endUnitPrice, startsAt, endsAt)
        );
    }

    function listINFTDutchAuction(
        address tokenContract,
        uint256 tokenId,
        address paymentToken,
        uint256 startUnitPrice,
        uint256 endUnitPrice,
        uint64 startsAt,
        uint64 endsAt
    ) external nonReentrant returns (uint256 listingId) {
        listingId = _createERC721LikeListing(
            tokenContract,
            tokenId,
            paymentToken,
            endUnitPrice,
            TokenStandard.INFT,
            _dutchAuctionTerms(startUnitPrice, endUnitPrice, startsAt, endsAt)
        );
    }

    function listERC1155DutchAuction(
        address tokenContract,
        uint256 tokenId,
        uint256 quantity,
        address paymentToken,
        uint256 startUnitPrice,
        uint256 endUnitPrice,
        uint64 startsAt,
        uint64 endsAt
    ) external nonReentrant returns (uint256 listingId) {
        listingId = _createERC1155Listing(
            tokenContract,
            tokenId,
            quantity,
            paymentToken,
            endUnitPrice,
            _dutchAuctionTerms(startUnitPrice, endUnitPrice, startsAt, endsAt)
        );
    }

    function buy(uint256 listingId, uint256 quantity, address referrer) external payable nonReentrant {
        _buyFor(listingId, quantity, msg.sender, referrer, true);
    }

    function makeOffer(
        uint256 listingId,
        uint256 quantity,
        uint256 sellerUnitAmount,
        uint64 expiresAt,
        address referrer
    ) external payable nonReentrant returns (uint256 offerId) {
        Listing storage listing = listings[listingId];
        require(listing.active, "inactive");
        require(listing.acceptsOffers, "offers disabled");
        require(sellerUnitAmount > 0, "amount required");
        require(expiresAt > block.timestamp, "expired");

        uint256 purchaseQuantity = _normalizedQuantity(listing, quantity);
        require(purchaseQuantity <= listing.quantityAvailable, "insufficient quantity");

        SaleDistribution memory distribution = _distributionStruct(
            sellerUnitAmount * purchaseQuantity,
            listing.seller,
            referrer,
            msg.sender
        );

        offerId = nextOfferId++;
        offers[offerId] = Offer({
            listingId: listingId,
            bidder: msg.sender,
            referrer: distribution.payableReferrer,
            quantity: purchaseQuantity,
            sellerAmount: distribution.sellerAmount,
            platformFee: distribution.platformFee,
            referrerFee: distribution.referrerFee,
            totalAmount: distribution.total,
            expiresAt: expiresAt,
            active: true
        });

        _collectOfferEscrow(listing.paymentToken, distribution.total);
        emit OfferCreated(
            offerId,
            listingId,
            msg.sender,
            distribution.payableReferrer,
            purchaseQuantity,
            distribution.sellerAmount,
            distribution.platformFee,
            distribution.referrerFee,
            distribution.total,
            expiresAt
        );
    }

    function acceptOffer(uint256 offerId) external nonReentrant {
        Offer storage offer = offers[offerId];
        require(offer.active, "inactive offer");
        require(offer.expiresAt >= block.timestamp, "expired");

        Listing storage listing = listings[offer.listingId];
        require(listing.active, "inactive listing");
        require(msg.sender == listing.seller || msg.sender == owner(), "not authorized");
        require(offer.quantity <= listing.quantityAvailable, "insufficient quantity");

        offer.active = false;
        listing.quantityAvailable -= offer.quantity;
        if (listing.quantityAvailable == 0) {
            listing.active = false;
        }

        _distributeEscrowed(
            listing.paymentToken,
            listing.seller,
            offer.referrer,
            offer.sellerAmount,
            offer.platformFee,
            offer.referrerFee
        );
        _transferAsset(listing, offer.bidder, offer.quantity);

        emit OfferAccepted(offerId, offer.listingId);
        emit ListingPurchased(
            offer.listingId,
            offer.bidder,
            offer.referrer,
            offer.quantity,
            offer.sellerAmount,
            offer.platformFee,
            offer.referrerFee,
            listing.paymentToken
        );
    }

    function cancelOffer(uint256 offerId) external nonReentrant {
        Offer storage offer = offers[offerId];
        require(offer.active, "inactive offer");
        require(msg.sender == offer.bidder || msg.sender == owner() || offer.expiresAt < block.timestamp, "not authorized");

        Listing storage listing = listings[offer.listingId];
        offer.active = false;
        _refundEscrow(listing.paymentToken, offer.bidder, offer.totalAmount);
        emit OfferCancelled(offerId, offer.listingId);
    }

    function fulfillKeeperHubPurchase(
        uint256 listingId,
        uint256 quantity,
        address buyer,
        address referrer
    ) external nonReentrant {
        require(msg.sender == keeperHubExecutor || msg.sender == owner(), "not keeperhub");
        _buyFor(listingId, quantity, buyer, referrer, false);
    }

    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "inactive");
        require(msg.sender == listing.seller || msg.sender == owner(), "not authorized");

        listing.active = false;
        uint256 remaining = listing.quantityAvailable;
        listing.quantityAvailable = 0;
        _transferAsset(listing, listing.seller, remaining);

        emit ListingCancelled(listingId);
    }

    function setListingAcceptsOffers(uint256 listingId, bool acceptsOffers) external {
        Listing storage listing = listings[listingId];
        require(listing.active, "inactive");
        require(msg.sender == listing.seller || msg.sender == owner(), "not authorized");
        listing.acceptsOffers = acceptsOffers;
        emit ListingOffersUpdated(listingId, acceptsOffers);
    }

    function currentUnitPrice(uint256 listingId) public view returns (uint256) {
        Listing storage listing = listings[listingId];
        require(listing.active, "inactive");
        return _currentUnitPrice(listing);
    }

    function saleQuote(uint256 listingId, uint256 quantity, address referrer)
        external
        view
        returns (uint256 sellerAmount, uint256 platformFee, uint256 referrerFee, uint256 total)
    {
        Listing storage listing = listings[listingId];
        require(listing.active, "inactive");
        uint256 purchaseQuantity = _normalizedQuantity(listing, quantity);
        return _distribution(_currentUnitPrice(listing) * purchaseQuantity, listing.seller, referrer, msg.sender);
    }

    function offerQuote(uint256 listingId, uint256 quantity, uint256 sellerUnitAmount, address referrer)
        external
        view
        returns (uint256 sellerAmount, uint256 platformFee, uint256 referrerFee, uint256 total)
    {
        Listing storage listing = listings[listingId];
        require(listing.active, "inactive");
        uint256 purchaseQuantity = _normalizedQuantity(listing, quantity);
        return _distribution(sellerUnitAmount * purchaseQuantity, listing.seller, referrer, msg.sender);
    }

    function setPlatformTreasury(address treasury) external onlyOwner {
        require(treasury != address(0), "treasury required");
        platformTreasury = treasury;
        emit PlatformTreasuryUpdated(treasury);
    }

    function setKeeperHubExecutor(address executor) external onlyOwner {
        keeperHubExecutor = executor;
        emit KeeperHubExecutorUpdated(executor);
    }

    function setFeeConfig(
        uint16 newPlatformFeeBps,
        uint16 newReferrerFeeBps,
        uint16 newNoReferrerPlatformFeeBps
    ) external onlyOwner {
        require(newPlatformFeeBps + newReferrerFeeBps <= 3_000, "ref fee too high");
        require(newNoReferrerPlatformFeeBps <= 3_000, "platform fee too high");
        platformFeeBps = newPlatformFeeBps;
        referrerFeeBps = newReferrerFeeBps;
        noReferrerPlatformFeeBps = newNoReferrerPlatformFeeBps;
        emit FeeConfigUpdated(newPlatformFeeBps, newReferrerFeeBps, newNoReferrerPlatformFeeBps);
    }

    function _createERC721LikeListing(
        address tokenContract,
        uint256 tokenId,
        address paymentToken,
        uint256 unitPrice,
        TokenStandard tokenStandard,
        Listing memory terms
    ) internal returns (uint256 listingId) {
        require(tokenContract != address(0), "token required");
        require(unitPrice > 0, "price required");
        require(tokenStandard == TokenStandard.ERC721 || tokenStandard == TokenStandard.INFT, "invalid standard");

        listingId = nextListingId++;
        listings[listingId] = Listing({
            seller: msg.sender,
            tokenContract: tokenContract,
            paymentToken: paymentToken,
            tokenId: tokenId,
            unitPrice: unitPrice,
            quantityAvailable: 1,
            tokenStandard: tokenStandard,
            saleMechanism: terms.saleMechanism,
            startUnitPrice: terms.startUnitPrice,
            startsAt: terms.startsAt,
            endsAt: terms.endsAt,
            acceptsOffers: false,
            active: true
        });

        IERC721(tokenContract).safeTransferFrom(msg.sender, address(this), tokenId);
        emit ListingCreated(
            listingId,
            msg.sender,
            tokenContract,
            tokenId,
            tokenStandard,
            terms.saleMechanism,
            1,
            paymentToken,
            unitPrice
        );
    }

    function _createERC1155Listing(
        address tokenContract,
        uint256 tokenId,
        uint256 quantity,
        address paymentToken,
        uint256 unitPrice,
        Listing memory terms
    ) internal returns (uint256 listingId) {
        require(tokenContract != address(0), "token required");
        require(quantity > 0, "quantity required");
        require(unitPrice > 0, "price required");

        listingId = nextListingId++;
        listings[listingId] = Listing({
            seller: msg.sender,
            tokenContract: tokenContract,
            paymentToken: paymentToken,
            tokenId: tokenId,
            unitPrice: unitPrice,
            quantityAvailable: quantity,
            tokenStandard: TokenStandard.ERC1155,
            saleMechanism: terms.saleMechanism,
            startUnitPrice: terms.startUnitPrice,
            startsAt: terms.startsAt,
            endsAt: terms.endsAt,
            acceptsOffers: false,
            active: true
        });

        IERC1155(tokenContract).safeTransferFrom(msg.sender, address(this), tokenId, quantity, "");
        emit ListingCreated(
            listingId,
            msg.sender,
            tokenContract,
            tokenId,
            TokenStandard.ERC1155,
            terms.saleMechanism,
            quantity,
            paymentToken,
            unitPrice
        );
    }

    function _fixedPriceTerms(uint256 unitPrice) internal pure returns (Listing memory terms) {
        terms.saleMechanism = SaleMechanism.FixedPrice;
        terms.startUnitPrice = unitPrice;
    }

    function _dutchAuctionTerms(
        uint256 startUnitPrice,
        uint256 endUnitPrice,
        uint64 startsAt,
        uint64 endsAt
    ) internal view returns (Listing memory terms) {
        require(startUnitPrice > 0, "start price required");
        require(endUnitPrice > 0, "end price required");
        require(startUnitPrice >= endUnitPrice, "invalid price curve");
        uint64 effectiveStartsAt = startsAt == 0 ? uint64(block.timestamp) : startsAt;
        require(endsAt > effectiveStartsAt, "invalid auction");
        require(endsAt > block.timestamp, "auction ended");
        terms.saleMechanism = SaleMechanism.DutchAuction;
        terms.startUnitPrice = startUnitPrice;
        terms.startsAt = effectiveStartsAt;
        terms.endsAt = endsAt;
    }

    function _buyFor(
        uint256 listingId,
        uint256 quantity,
        address buyer,
        address referrer,
        bool collectPayment
    ) internal {
        Listing storage listing = listings[listingId];
        require(listing.active, "inactive");
        require(buyer != address(0), "buyer required");

        uint256 purchaseQuantity = _normalizedQuantity(listing, quantity);
        require(purchaseQuantity <= listing.quantityAvailable, "insufficient quantity");

        (
            uint256 sellerAmount,
            uint256 platformFee,
            uint256 referrerFee,
            uint256 total
        ) = _distribution(_currentUnitPrice(listing) * purchaseQuantity, listing.seller, referrer, buyer);

        listing.quantityAvailable -= purchaseQuantity;
        if (listing.quantityAvailable == 0) {
            listing.active = false;
        }

        if (collectPayment) {
            _collectAndDistribute(
                listing.paymentToken,
                listing.seller,
                referrer,
                sellerAmount,
                platformFee,
                referrerFee,
                total
            );
        }
        _transferAsset(listing, buyer, purchaseQuantity);

        emit ListingPurchased(
            listingId,
            buyer,
            referrerFee > 0 ? referrer : address(0),
            purchaseQuantity,
            sellerAmount,
            platformFee,
            referrerFee,
            listing.paymentToken
        );
    }

    function _normalizedQuantity(Listing storage listing, uint256 quantity) internal view returns (uint256) {
        if (listing.tokenStandard == TokenStandard.ERC721 || listing.tokenStandard == TokenStandard.INFT) {
            require(quantity == 0 || quantity == 1, "quantity must be 1");
            return 1;
        }
        require(quantity > 0, "quantity required");
        return quantity;
    }

    function _currentUnitPrice(Listing storage listing) internal view returns (uint256) {
        if (listing.saleMechanism != SaleMechanism.DutchAuction) {
            return listing.unitPrice;
        }
        if (block.timestamp <= listing.startsAt) {
            return listing.startUnitPrice;
        }
        if (block.timestamp >= listing.endsAt) {
            return listing.unitPrice;
        }
        uint256 elapsed = block.timestamp - listing.startsAt;
        uint256 duration = listing.endsAt - listing.startsAt;
        uint256 priceDrop = listing.startUnitPrice - listing.unitPrice;
        return listing.startUnitPrice - ((priceDrop * elapsed) / duration);
    }

    function _distribution(uint256 sellerAmount, address seller, address referrer, address buyer)
        internal
        view
        returns (uint256 totalSellerAmount, uint256 platformFee, uint256 referrerFee, uint256 total)
    {
        bool hasReferrer = referrer != address(0) && referrer != seller && referrer != buyer;
        totalSellerAmount = sellerAmount;
        if (hasReferrer) {
            platformFee = (sellerAmount * platformFeeBps) / BPS_DENOMINATOR;
            referrerFee = (sellerAmount * referrerFeeBps) / BPS_DENOMINATOR;
        } else {
            platformFee = (sellerAmount * noReferrerPlatformFeeBps) / BPS_DENOMINATOR;
            referrerFee = 0;
        }
        total = sellerAmount + platformFee + referrerFee;
        return (totalSellerAmount, platformFee, referrerFee, total);
    }

    function _distributionStruct(uint256 sellerAmount, address seller, address referrer, address buyer)
        internal
        view
        returns (SaleDistribution memory distribution)
    {
        (
            distribution.sellerAmount,
            distribution.platformFee,
            distribution.referrerFee,
            distribution.total
        ) = _distribution(sellerAmount, seller, referrer, buyer);
        distribution.payableReferrer = distribution.referrerFee > 0 ? referrer : address(0);
    }

    function _collectAndDistribute(
        address paymentToken,
        address seller,
        address referrer,
        uint256 sellerAmount,
        uint256 platformFee,
        uint256 referrerFee,
        uint256 total
    ) internal {
        if (paymentToken == address(0)) {
            require(msg.value >= total, "insufficient native payment");
            _sendNative(seller, sellerAmount);
            _sendNative(platformTreasury, platformFee);
            if (referrerFee > 0) {
                _sendNative(referrer, referrerFee);
            }
            if (msg.value > total) {
                _sendNative(msg.sender, msg.value - total);
            }
            return;
        }

        require(msg.value == 0, "native value not accepted");
        IERC20 token = IERC20(paymentToken);
        token.safeTransferFrom(msg.sender, seller, sellerAmount);
        token.safeTransferFrom(msg.sender, platformTreasury, platformFee);
        if (referrerFee > 0) {
            token.safeTransferFrom(msg.sender, referrer, referrerFee);
        }
    }

    function _collectOfferEscrow(address paymentToken, uint256 total) internal {
        if (paymentToken == address(0)) {
            require(msg.value >= total, "insufficient native payment");
            if (msg.value > total) {
                _sendNative(msg.sender, msg.value - total);
            }
            return;
        }
        require(msg.value == 0, "native value not accepted");
        IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), total);
    }

    function _distributeEscrowed(
        address paymentToken,
        address seller,
        address referrer,
        uint256 sellerAmount,
        uint256 platformFee,
        uint256 referrerFee
    ) internal {
        if (paymentToken == address(0)) {
            _sendNative(seller, sellerAmount);
            _sendNative(platformTreasury, platformFee);
            if (referrerFee > 0) {
                _sendNative(referrer, referrerFee);
            }
            return;
        }
        IERC20 token = IERC20(paymentToken);
        token.safeTransfer(seller, sellerAmount);
        token.safeTransfer(platformTreasury, platformFee);
        if (referrerFee > 0) {
            token.safeTransfer(referrer, referrerFee);
        }
    }

    function _refundEscrow(address paymentToken, address recipient, uint256 amount) internal {
        if (paymentToken == address(0)) {
            _sendNative(recipient, amount);
            return;
        }
        IERC20(paymentToken).safeTransfer(recipient, amount);
    }

    function _transferAsset(Listing storage listing, address to, uint256 quantity) internal {
        if (quantity == 0) {
            return;
        }
        if (listing.tokenStandard == TokenStandard.ERC1155) {
            IERC1155(listing.tokenContract).safeTransferFrom(address(this), to, listing.tokenId, quantity, "");
        } else {
            IERC721(listing.tokenContract).safeTransferFrom(address(this), to, listing.tokenId);
        }
    }

    function _sendNative(address recipient, uint256 amount) internal {
        if (amount == 0) {
            return;
        }
        (bool ok, ) = recipient.call{value: amount}("");
        require(ok, "native transfer failed");
    }
}
