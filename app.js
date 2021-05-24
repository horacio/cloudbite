// Shove all cards from all decks into flipcards.
flipcards = [];
for (let i = 0; i < ethereum_cards.length; i++) {
    const card = ethereum_cards[i];
    card.deck = "ethereum";
    flipcards.push(card);
}
for (let i = 0; i < aws_cards.length; i++) {
    const card = aws_cards[i];
    card.deck = "aws";
    flipcards.push(card);
}

// Constants
const PRIO_INITIAL = 1000;
const PRIO_INCREASE_LATER = 10;
const PRIO_INCREASE_SOON = 1;
const PRIO_INCREASE_NEVER = Number.POSITIVE_INFINITY;
const LOCAL_STORAGE_KEY = "cloudbite-userdata";
const LOCAL_STORAGE_DUPLICATE_DETECTION_KEY = "cloudbite-latest-session-id";

// State
let currentDeck = "aws";
let flipped = false;
let currentCard = null;
let permanentRotation = 0;
let mouseDownCard = null;
let mouseDragging = false;
let lastMoveCoordinates = null;
let userData = null;
let sessionIdForDuplicateDetection = null;

const get = function (id) {
    return document.getElementById(id);
};

const getByClass = function (className) {
    return Array.from(document.getElementsByClassName(className));
};

const disableButtons = function () {
    get("navigation-bar").style.opacity = "0.3";
    get("navigation-bar").style.pointerEvents = "none";
    get("action-bar").style.opacity = "0.3";
    get("action-bar").style.pointerEvents = "none";
};

const enableButtons = function () {
    get("navigation-bar").style.opacity = "1";
    get("navigation-bar").style.pointerEvents = "auto";
    get("action-bar").style.opacity = "1";
    get("action-bar").style.pointerEvents = "auto";
};

const onToggleUserCard = function () {
    if (get("user-data-card").style.visibility == "visible") {
        get("user-data-card").style.visibility = "hidden";
        enableButtons();
    } else {
        const streakHits = userData.last100streak.reduce((a, b) => a + b, 0);
        const streakLength = userData.last100streak.length;
        const streakPercent = Math.round((100 * streakHits) / streakLength) || 0;
        get("user-data-card-text").innerHTML = `
        Hello, <b>${userData.name}</b>.<br><br>
        That's your autogenerated username. If it changes, that's a sign your user data has been deleted.<br><br>
        Your data is saved locally. It is never uploaded to our servers or anywhere else.<br><br>
        You have flipped through <b>${userData.countCardsSeen}</b> cards (<b>${Object.keys(userData.prioForHash).length}</b> unique).<br>
        There are ${flipcards.length} unique cards in total.<br><br>
        You are currently on a streak of <b>${streakPercent}%</b><br>
        (${streakHits} hits out of ${streakLength} attempts).
        `;
        get("user-data-card").style.visibility = "visible";
        disableButtons();
    }
};

const deckFilterClear = function () {
    get("deck-filter-clear-button").style.visibility = "hidden";
    get("deck-filter-input").value = "";
};

const onMouseDownCard = function (event) {
    mouseDownCard = {
        x: event.clientX || event.targetTouches[0].pageX,
        y: event.clientY || event.targetTouches[0].pageY,
    };
};

// Note: onMouseUpCard event needs to be triggered before onMouseUpAnywhere!
const onMouseUpCard = function (delta) {
    if (mouseDownCard && !mouseDragging) {
        flip(delta);
    }
};

const onMouseUpAnywhere = function (event) {
    mouseDownCard = false;
    if (!mouseDragging) {
        return;
    }
    stopDragging();
};

const stopDragging = function () {
    mouseDragging = false;
    // Since we are no longer dragging we want to re-enable animations.
    get("flip-card-outer-container").style.transition = `transform 0.4s`;
    // User may or may not be hovering over a drop box.
    const dropBox = document.elementFromPoint(lastMoveCoordinates.x, lastMoveCoordinates.y);
    const dropBoxId = (dropBox ? dropBox.id : "") || "";
    if (dropBoxId.startsWith("abi-later")) {
        // We use "startsWith" instead of "equals" because "elementFromPoint" may return
        // the div of the action bar item, the svg-container inside the div, or the path inside the svg-container.
        // All of these objects have been given ids with the same prefix.
        repeatLater();
    } else if (dropBoxId.startsWith("abi-soon")) {
        repeatSoon();
    } else if (dropBoxId.startsWith("abi-never")) {
        repeatNever();
    } else {
        // Case: drag-and-dropped card over nothing, so animate card back to its position.
        get("flip-card-outer-container").style.transform = `translate(0px, 0px)`;
        // Hide potemkin card after real card lands, because it looks weird when real card is rotated +-10 over it.
        window.setTimeout(() => {
            get("potemkin-card").style.visibility = "hidden";
        }, 400);
    }
};

const onMouseMove = function (event) {
    if (!mouseDownCard) {
        // We only care about mouse moves when dragging card.
        return;
    }
    if (!event.clientX && !event.targetTouches) {
        // Dragging card outside viewport, unable to get coordinates.
        return;
    }
    const x = event.clientX || event.targetTouches[0].pageX;
    const y = event.clientY || event.targetTouches[0].pageY;
    const diffX = x - mouseDownCard.x;
    const diffY = y - mouseDownCard.y;
    lastMoveCoordinates = {
        x: x,
        y: y,
    };
    if (mouseDragging || Math.abs(diffX) + Math.abs(diffY) > 20) {
        mouseDragging = true;
        // Drag card
        get("flip-card-outer-container").style.transition = `transform 0s`;
        get("flip-card-outer-container").style.transform = `translate(${diffX}px, ${diffY}px)`;
        // Reset card temporary-rotation because that +-10 rotation looks weird when dragged.
        rotate(0);
        // Make potemkin card visible because it looks nice when real card snaps to its position.
        get("potemkin-card").style.visibility = "visible";
    }
};

document.addEventListener("keydown", (e) => {
    if (get("user-data-card").style.visibility == "visible") {
        // Disable keyboard shortcuts while the user data card is open.
        return;
    }
    if (get("add-card-input").style.visibility == "visible") {
        // Disable keyboard shortcuts while the add-new-card input is open.
        return;
    }
    if (get("deck-filter").style.visibility == "visible") {
        if (e.code === "Enter") {
            // If deck filter is visible, user is choosing deck / setting a custom filter and pressing enter.
            // Assume that user wants to re-select previously chosen deck, with possibly new filters.
            deckSelectionClose(currentDeck);
        }
        // Prevent other keydown events when deck filter is visible.
        return;
    }
    if (e.code === "ArrowRight" || e.code === "ArrowUp") {
        repeatLater();
    } else if (e.code === "ArrowDown" || e.code === "ArrowDown") {
        repeatSoon();
    } else if (e.code === "Enter") {
        flip(180);
    } else if (e.code === "Space") {
        flip(-180);
    }
});

// Event listener to display or hide the "clear filter" button.
document.addEventListener("keyup", (e) => {
    if (get("deck-filter").style.visibility == "visible") {
        if (get("deck-filter-input").value != "") {
            get("deck-filter-clear-button").style.visibility = "visible";
        } else {
            get("deck-filter-clear-button").style.visibility = "hidden";
        }
    }
});

// Event listeners for move-mouse or drag-with-touchscreen
document.addEventListener("mousemove", (e) => {
    onMouseMove(e);
});
document.addEventListener(
    "touchmove",
    (e) => {
        if (mouseDownCard) {
            onMouseMove(e);
            e.preventDefault();
        }
    },
    // Workaround to an issue that I noticed in Chrome but ONLY WHEN devtools is NOT open!
    // If we don't preventDefault, then for some reason the touchmove events trigger infrequently
    // and the experience feels laggy. So we want to preventDefault, and in order to do that
    // we need to add the "passive: false". Not sure why any of this works but it does.
    // Note that we only want to preventDefault went card is being dragged, otherwise we
    // prevent touch screen devices from zooming with touch motions.
    { passive: false }
);

// Event listener for multi-finger touch to prevent accidental dragging
document.addEventListener("touchstart", (e) => {
    if (e.touches.length > 1) {
        onMouseUpAnywhere();
    }
});

// Event listeners for left-mouse-up-anywhere or stop-dragging-with-touchscreen-anywhere
document.addEventListener("mouseup", (e) => {
    if (e.which == 1) {
        onMouseUpAnywhere(e);
    }
});
document.addEventListener("touchend", (e) => {
    onMouseUpAnywhere(e);
    if (e.target && (e.target.id === "card-right" || e.target.kid === "card-left")) {
        e.preventDefault(); // Prevent triggering a mouseup event.
    }
});

// Event listeners for left-mouse-down or start-dragging-with-touchscreen on CARD-LEFT
get("card-left").addEventListener("mousedown", (e) => {
    if (e.which == 1) {
        onMouseDownCard(e);
    }
});
get("card-left").addEventListener("touchstart", (e) => {
    onMouseDownCard(e);
});

// Event listener for left-mouse-up or touchscreen-tap on CARD-LEFT
get("card-left").addEventListener("mouseup", (e) => {
    if (e.which == 1) {
        onMouseUpCard(-180);
    }
});
get("card-left").addEventListener("touchend", (e) => {
    onMouseUpCard(-180);
    e.preventDefault(); // Prevent triggering a mouseup event.
});

// Event listeners for left-mouse-down or start-dragging-with-touchscreen on CARD-RIGHT
get("card-right").addEventListener("mousedown", (e) => {
    if (e.which == 1) {
        onMouseDownCard(e);
    }
});
get("card-right").addEventListener("touchstart", (e) => {
    onMouseDownCard(e);
});

// Event listener for left-mouse-up or touchscreen-tap on CARD-RIGHT
get("card-right").addEventListener("mouseup", (e) => {
    if (e.which == 1) {
        onMouseUpCard(180);
    }
});
get("card-right").addEventListener("touchend", (e) => {
    onMouseUpCard(180);
    e.preventDefault(); // Prevent triggering a mouseup event.
});

const rotate = function (temporaryRotation) {
    const deg = permanentRotation + temporaryRotation;
    get("flip-card-inner-container").style.transform = `rotateY(${deg}deg)`;
};
const hover = function (delta) {
    rotate(delta);
};
const flip = function (delta) {
    flipped = !flipped;
    permanentRotation += delta;
    rotate(0);
};

// Hash algorithm from https://stackoverflow.com/a/7616484/4490400
hash = function (flipcard) {
    let hash = 0;
    const str = flipcard.q + ";;;" + flipcard.a;
    for (let i = 0; i < str.length; i++) {
        let chr = str.charCodeAt(i);
        hash = (hash << 5) - hash + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
};

const saveStateToLocalStorage = function () {
    // Prevent issue where user is running Cloudbite in 2 tabs, which would overwrite each others' changes to localStorage.
    if (sessionIdForDuplicateDetection != localStorage.getItem(LOCAL_STORAGE_DUPLICATE_DETECTION_KEY)) {
        alert(
            "Warning! It looks like you have used Cloudbite from another tab, and you are now using Cloudbite from an older tab which has stale data. In order to prevent possible data loss, we are not saving your changes from this tab to local storage. Please close this tab and open a new tab for Cloudbite."
        );
        return;
    }
    userData.prioForHash = {};
    for (let i = 0; i < flipcards.length; i++) {
        const c = flipcards[i];
        if (c.prio !== PRIO_INITIAL) {
            // No need to save default prios, only those that user affected.
            userData.prioForHash[c.hash] = c.prio;
        }
    }
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(userData));
};

const getMinPrio = function (excludeCard) {
    let minPrio = Number.POSITIVE_INFINITY;
    for (let i = 0; i < flipcards.length; i++) {
        const card = flipcards[i];
        if (card === excludeCard) {
            continue;
        }
        if (card.prio < minPrio) {
            minPrio = card.prio;
        }
    }
    return minPrio;
};

const initializeUserSession = function () {
    // Load userData from localStorage or initialize it for new user.
    userData = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (userData) {
        userData = JSON.parse(userData);
    } else {
        userData = {
            name: generateName(),
            prioForHash: {},
            countCardsSeen: 0,
            last100streak: [],
        };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(userData));
    }
    // These are for detecting when user has Cloudbite simultaneously open in 2 tabs
    sessionIdForDuplicateDetection = Math.random();
    localStorage.setItem(LOCAL_STORAGE_DUPLICATE_DETECTION_KEY, sessionIdForDuplicateDetection);
    // Adjust flipcards according to prios in userData.
    let minPriosInUserData = {
        aws: Number.POSITIVE_INFINITY,
        azure: Number.POSITIVE_INFINITY,
        gcp: Number.POSITIVE_INFINITY,
        ethereum: Number.POSITIVE_INFINITY
    };
    for (let i = 0; i < flipcards.length; i++) {
        const c = flipcards[i];
        c.hash = hash(c);
        c.prio = PRIO_INITIAL;
        if (c.hash in userData.prioForHash) {
            c.prio = userData.prioForHash[c.hash];
            if (!c.prio) {
                // Case: card was "trashed", JSONified cookie had undefined/null.
                c.prio = Number.POSITIVE_INFINITY;
            }
            minPriosInUserData[c.deck] = Math.min(c.prio, minPriosInUserData[c.deck]);
        }
    }
    // Deal with special case where new cards are added after old cards have drifted far away in userData prios.
    ["aws", "azure", "gcp", "ethereum"].forEach((deck) => {
        const minPrioInUserData = minPriosInUserData[deck];
        if (minPrioInUserData - PRIO_INITIAL > PRIO_INCREASE_LATER && minPrioInUserData < PRIO_INCREASE_NEVER) {
            for (let i = 0; i < flipcards.length; i++) {
                const c = flipcards[i];
                if (c.deck != deck) {
                    continue;
                }
                // We want to help new cards "catch up" towards old cards in prios.
                c.prio = Math.max(c.prio, minPrioInUserData - PRIO_INCREASE_LATER);
            }
        }
    });
};

const throwAwayCard = function (translateX, translateY) {
    get("flip-card-outer-container").style.transform = `translate(${translateX}px, ${translateY}px) scale(0)`;
};

const tokenize = function (text) {
    let tokens = [];
    let curr = "";
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if ("abcdefghijklmnopqrstuvwxyz0123456789".includes(c)) {
            curr += c;
        } else if (curr !== "") {
            tokens.push(curr);
            curr = "";
        }
    }
    return tokens;
};

const doesCardMatchSearchQuery = function (card, searchQuery) {
    if (searchQuery.includes(" ") || searchQuery.includes("-")) {
        // If search query includes space or dash, we can do a simple search without worrying about false positives.
        return card.q.toLowerCase().includes(searchQuery.toLowerCase()) || card.a.toLowerCase().includes(searchQuery.toLowerCase());
    }
    // Otherwise, we may have issues with false positives.
    // For example, search "RDS" will match to text "birds".
    // To prevent false positives, we need to tokenize and search for token match.
    tokenized = tokenize(card.q.toLowerCase() + "," + card.a.toLowerCase());
    for (let i = 0; i < tokenized.length; i++) {
        if (tokenized[i] === searchQuery.toLowerCase()) {
            return true;
        }
    }
    return false;
};

const changeCurrentCard = function () {
    let minPrio = Number.POSITIVE_INFINITY;
    let minCard = null;
    let searchQuery = get("deck-filter-input").value;
    for (let i = 0; i < flipcards.length; i++) {
        const card = flipcards[i];
        if (card.deck != currentDeck) {
            continue;
        }
        if (card === currentCard) {
            continue;
        }
        if (searchQuery && !doesCardMatchSearchQuery(card, searchQuery)) {
            continue;
        }
        const prio = card.prio + Math.random(); // Random (between 0-1) is useful to break ties (shuffle).
        if (prio < minPrio) {
            minPrio = prio;
            minCard = card;
        }
    }
    if (!minCard) {
        minCard = {
            q: "Whoops, looks like we ran out of cards.",
            a: "Nothing to see here.",
        };
        if (get("deck-filter-input").value != "") {
            minCard.q += ` You are currently filtering the deck for '${get("deck-filter-input").value}'. Try modifying your search query?`;
        }
    }
    currentCard = minCard;
};

const decoratePotemkin = function () {
    get("potemkin-card").style.visibility = "visible";
    get("potemkin-card-front-container").style.visibility = "visible";
    get("potemkin-card-front").innerHTML = currentCard.q;
};

const resetCardOrientationQuickly = function () {
    get("flip-card-outer-container").style.visibility = "hidden";
    get("flip-card-outer-container").style.transition = `transform 0s`; // For position snap reset
    get("flip-card-outer-container").style.transform = `translate(0px, 0px)`;
    get("flip-card-inner-container").style.transition = `transform 0s`; // For rotation snap reset
    flipped = false;
    permanentRotation = 0;
    rotate(0);
};

const renderRealCard = function () {
    // Set content
    get("flip-card-front").innerHTML = currentCard.q;
    get("flip-card-back").innerHTML = currentCard.a;

    // We need to set these again because resetCardOrientationQuickly may have changed them to 0.
    get("flip-card-outer-container").style.transition = `transform 0.4s`;
    get("flip-card-inner-container").style.transition = `transform 0.4s`;

    // Make card visible again.
    get("flip-card-outer-container").style.visibility = "visible";

    // Hide potemkin card because it looks ugly when overlaying card is rotated +-10
    get("potemkin-card").style.visibility = "hidden";

    // Potemkin card contents should be hidden as soon as we get real card on top of it.
    get("potemkin-card-front-container").style.visibility = "hidden";

    // Add deck logo on the left top of the card.
    getByClass("cloud-provider-on-card").forEach(element => element.src = 'assets/logo_' + currentDeck + '.svg')
};

const deckSelectionOpen = function () {
    throwAwayCard(-260, -270);
    disableButtons();
    // deck filter
    get("deck-filter").style.visibility = "visible";
    // aws deck option
    get("deck-option-aws").style.top = "0px";
    get("deck-option-aws").style.visibility = "visible";
    window.setTimeout(() => {
        get("deck-option-aws").style.pointerEvents = "auto";
    }, 400);
    get("cloud-provider-on-deck-aws").style.visibility = "visible";
    // ethereum deck option
    get("deck-option-ethereum").style.top = "85px";
    get("deck-option-ethereum").style.visibility = "visible";
    get("cloud-provider-on-deck-ethereum").style.visibility = "visible";
    window.setTimeout(() => {
        get("deck-option-ethereum").style.pointerEvents = "auto";
    }, 400);
    // azure deck option
    get("deck-option-azure").style.top = "170px";
    get("deck-option-azure").style.visibility = "visible";
    get("cloud-provider-on-deck-azure").style.visibility = "visible";
    get("coming-soon-text-azure").style.visibility = "visible";
    // gcp deck option
    get("deck-option-gcp").style.top = "255px";
    get("deck-option-gcp").style.visibility = "visible";
    get("cloud-provider-on-deck-gcp").style.visibility = "visible";
    get("coming-soon-text-gcp").style.visibility = "visible";
    // Rotate card front way up while it's going into the deck.
    if (flipped) {
        // Note: we don't want to set permanentRotation to 0 because it might flap like a hummingbird.
        permanentRotation -= 180;
        flipped = false;
        rotate(0);
    }
};

const deckSelectionClose = function (choice) {
    // set deck and draw new currentCard from deck
    currentDeck = choice;
    changeCurrentCard();
    // deck filter
    get("deck-filter").style.visibility = "hidden";
    // animate aws deck option
    get("deck-option-aws").style.top = "-85px"; /* 0.4s transition */
    get("deck-option-aws").style.visibility = "hidden"; /* 0.4s transition */
    get("deck-option-aws").style.pointerEvents = "none";
    get("cloud-provider-on-deck-aws").style.visibility = "hidden"; /* 0s transition */
    // animate ethereum deck option
    get("deck-option-ethereum").style.top = "-85px"; /* 0.4s transition */
    get("deck-option-ethereum").style.visibility = "hidden"; /* 0.4s transition */
    get("deck-option-ethereum").style.pointerEvents = "none";
    get("cloud-provider-on-deck-ethereum").style.visibility = "hidden"; /* 0s transition */
    // animate azure deck option
    get("deck-option-azure").style.top = "-85px"; /* 0.4s transition */
    get("deck-option-azure").style.visibility = "hidden"; /* 0.4s transition */
    get("cloud-provider-on-deck-azure").style.visibility = "hidden"; /* 0s transition */
    get("coming-soon-text-azure").style.visibility = "hidden"; /* 0s transition */
    // animate gcp deck option
    get("deck-option-gcp").style.top = "-85px"; /* 0.4s transition */
    get("deck-option-gcp").style.visibility = "hidden"; /* 0.4s transition */
    get("cloud-provider-on-deck-gcp").style.visibility = "hidden"; /* 0s transition */
    get("coming-soon-text-gcp").style.visibility = "hidden"; /* 0s transition */
    // animate card back into place
    get("flip-card-outer-container").style.transform = `translate(0px, 0px)`;
    rotate(0);
    renderRealCard();
    // re-enable buttons
    enableButtons();
};

const updateStreak = function (latestVal) {
    userData.last100streak.push(latestVal);
    userData.last100streak = userData.last100streak.slice(Math.max(0, userData.last100streak.length - 30));
};

const repeatSoon = function () {
    updateStreak(0);
    userData.countCardsSeen += 1;
    switchCard(PRIO_INCREASE_SOON, 0, 260);
};

const repeatLater = function () {
    updateStreak(1);
    userData.countCardsSeen += 1;
    switchCard(PRIO_INCREASE_LATER, -200, 260);
};

const repeatNever = function () {
    userData.countCardsSeen += 1;
    switchCard(PRIO_INCREASE_NEVER, 200, 260);
};

const switchCard = function (prioIncrease, translateX, translateY) {
    currentCard.prio += prioIncrease;
    const minPrioFromOtherCards = getMinPrio(currentCard);
    if (currentCard.prio < minPrioFromOtherCards) {
        // When a card is seen, its prio should always jump to AT LEAST the next card's prio.
        currentCard.prio = minPrioFromOtherCards;
    }
    // Visuals
    changeCurrentCard();
    decoratePotemkin();
    throwAwayCard(translateX, translateY);
    // Prevent edge case where touch device accidentally clicks button multiple times consecutively.
    get("action-bar").style.pointerEvents = "none";
    window.setTimeout(() => {
        get("action-bar").style.pointerEvents = "auto";
    }, 400);
    // Render real card over potemkin card
    window.setTimeout(resetCardOrientationQuickly, 400);
    window.setTimeout(renderRealCard, 500);
    // Save state
    saveStateToLocalStorage();
};

const toggleAddCardInput = function () {
    const e = get("add-card-input");
    if (e.style.visibility === "visible") {
        e.style.visibility = "hidden";
        enableButtons();
        // Reset card
        get("flip-card-front").innerHTML = currentCard.q;
        get("flip-card-back").innerHTML = currentCard.a;
    } else {
        e.style.visibility = "visible";
        renderPreviewCard();
        disableButtons();
    }
};

const renderPreviewCard = function () {
    const text = get("add-card-input").value;
    // Note: yes, we use eval here, but everything is local, so the user can only hack themselves.
    // We have to use eval, because it works with multi-line ` delimited strings, unlike JSON parser.
    const previewCard = eval("(" + text + ")");
    get("flip-card-front").innerHTML = previewCard.q;
    get("flip-card-back").innerHTML = previewCard.a;
};

get("add-card-input").addEventListener(
    "input",
    () => {
        renderPreviewCard();
    },
    false
);

// Initial setup
initializeUserSession();
changeCurrentCard();
renderRealCard();
get("flip-card-outer-container").style.visibility = "visible";

// Enable new-card-preview when running locally
if (document.location.origin.startsWith("file")) {
    get("add-card-button").style.visibility = "visible";
}
