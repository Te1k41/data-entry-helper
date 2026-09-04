// Proof-driven Fill preparation. Pure calculation: no file or network I/O.
// Guideline dates never supply fill values. They are used only to reproduce
// the live extension's date-proximity signal for the suggested-vessel ranking.
const portDictionary = require("./port-dictionary");
const vesselDictionary = require("./vessel-dictionary");
const { parseDate } = require("./date-translator");

const EU_COUNTRIES = new Set([
    "AUSTRIA", "BELGIUM", "BULGARIA", "CROATIA", "CYPRUS", "CZECH REPUBLIC",
    "DENMARK", "ESTONIA", "FINLAND", "FRANCE", "GERMANY", "GREECE", "HUNGARY",
    "IRELAND", "ITALY", "LATVIA", "LITHUANIA", "LUXEMBOURG", "MALTA",
    "NETHERLANDS", "POLAND", "PORTUGAL", "ROMANIA", "SLOVAKIA", "SLOVENIA",
    "SPAIN", "SWEDEN",
]);
const CATEGORY_RANK = { USA: 1, JAPAN: 2, EU_UK: 2 };
const WINDOW_DAYS = 7;
const DAY_MS = 86400000;

function normalizeCode(value) { return String(value || "").trim().toUpperCase(); }
function normalizeImo(value) {
    const normalized = String(value || "").trim();
    return /^\d{7}$/.test(normalized) ? normalized : null;
}
function normalizeVoyage(value) { return String(value || "").trim().toUpperCase(); }
function coreVoyage(value) {
    const core = normalizeVoyage(value).replace(/[A-Z]+$/, "");
    return /^\d+$/.test(core) ? core.replace(/^0+(?=\d)/, "") : core;
}

function voyagesMatch(guidelineVoyage, proofVoyage) {
    const guideline = normalizeVoyage(guidelineVoyage), proof = normalizeVoyage(proofVoyage);
    if (!guideline || !proof) return false;
    return /[A-Z]$/.test(guideline) ? guideline === proof : coreVoyage(guideline) === coreVoyage(proof);
}

function identityWords(value) {
    return new Set(String(value || "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
}
function isWordSubset(smaller, larger) {
    for (const word of smaller) if (!larger.has(word)) return false;
    return true;
}
function vesselNamesMatch(left, right) {
    const leftWords = identityWords(left), rightWords = identityWords(right);
    return Boolean(leftWords.size && rightWords.size) &&
        (isWordSubset(leftWords, rightWords) || isWordSubset(rightWords, leftWords));
}
function vesselIdentityDecision(proofName, guidelineName, proofCode, guidelineCode, proofImo, guidelineImo) {
    const normalizedProofImo = normalizeImo(proofImo || proofCode);
    const normalizedGuidelineImo = normalizeImo(guidelineImo || guidelineCode);
    if (normalizedProofImo && normalizedGuidelineImo) {
        return {
            matches: normalizedProofImo === normalizedGuidelineImo,
            method: "imo",
            proofImo: normalizedProofImo,
            guidelineImo: normalizedGuidelineImo,
            proofCode: normalizeCode(proofCode) || null,
            guidelineCode: normalizeCode(guidelineCode) || null,
        };
    }
    const normalizedProofCode = normalizeCode(proofCode), normalizedGuidelineCode = normalizeCode(guidelineCode);
    if (normalizedProofCode && normalizedGuidelineCode) {
        return {
            matches: normalizedProofCode === normalizedGuidelineCode,
            method: "canonical-vessel-code",
            proofCode: normalizedProofCode,
            guidelineCode: normalizedGuidelineCode,
        };
    }
    return {
        matches: vesselNamesMatch(proofName, guidelineName),
        method: "normalized-word-set",
        proofCode: normalizedProofCode || null,
        guidelineCode: normalizedGuidelineCode || null,
        proofImo: normalizedProofImo,
        guidelineImo: normalizedGuidelineImo,
    };
}

function templateFor(ports) {
    const source = Array.isArray(ports) ? ports : [];
    const firstCode = source.length ? normalizeCode(source[0].code) : "";
    const loopIndex = firstCode
        ? source.findIndex((port, index) => index > 0 && normalizeCode(port.code) === firstCode)
        : -1;
    return {
        firstCode,
        loopIndex,
        legs: source.map((port, index) => ({
            index,
            row: port.row,
            code: normalizeCode(port.code),
            name: port.name || "",
            isLoopClosure: loopIndex !== -1 && index === loopIndex,
            pastLoopBoundary: loopIndex !== -1 && index > loopIndex,
        })),
    };
}

function normalizedVesselName(value) {
    return String(value || "").trim().toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean).join(" ");
}

function proofGroupIdentity(proof, vesselCode) {
    const code = normalizeCode(vesselCode);
    return code ? `CODE:${code}` : `NAME:${normalizedVesselName(proof.vessel)}`;
}

function proofGroupKey(proof, vesselCode, proofIndex) {
    const voyage = coreVoyage(proof.voyage) || normalizeVoyage(proof.voyage);
    const identity = proofGroupIdentity(proof, vesselCode);
    return JSON.stringify([identity === "NAME:" ? `ROW:${proofIndex}` : identity, voyage]);
}

function getPortCategory(portName) {
    if (!portName) return null;
    const name = String(portName).trim().toUpperCase();
    if (name.endsWith("USA") || name.endsWith("CANADA")) return "USA";
    if (name.endsWith("JAPAN") || name.endsWith("JAP")) return "JAPAN";
    if (name.endsWith("UNITED KINGDOM")) return "EU_UK";
    for (const country of EU_COUNTRIES) if (name.endsWith(country)) return "EU_UK";
    return "OTHER";
}

function transitionCandidates(ports) {
    const candidates = [];
    for (let index = 1; index < ports.length; index++) {
        const currentCategory = getPortCategory(ports[index].port || ports[index].name);
        const previousCategory = getPortCategory(ports[index - 1].port || ports[index - 1].name);
        if (currentCategory === "OTHER" || currentCategory === previousCategory) continue;
        candidates.push({
            sequenceIndex: index,
            rotationIndex: ports[index].rotationIndex ?? ports[index].index,
            port: ports[index].port || ports[index].name || "",
            portCode: ports[index].portCode || ports[index].code || null,
            fromCategory: previousCategory,
            category: currentCategory,
            rank: CATEGORY_RANK[currentCategory],
        });
    }
    return candidates;
}

function editDistance(left, right) {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
        const current = [leftIndex];
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
            current[rightIndex] = Math.min(
                current[rightIndex - 1] + 1,
                previous[rightIndex] + 1,
                previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
            );
        }
        for (let index = 0; index < current.length; index++) previous[index] = current[index];
    }
    return previous[right.length];
}

function formatScheduleDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCFullYear()).slice(-2)}`;
}

function addDays(date, days) { return new Date(date.getTime() + days * DAY_MS); }
function daysBetween(from, to) { return (to.getTime() - from.getTime()) / DAY_MS; }
function roundScore(value) { return Math.round(value * 10) / 10; }

function guidelinePortForLeg(guidelinePorts, leg) {
    if (!leg) return null;
    const byRow = guidelinePorts.find(port => port && port.row !== undefined && leg.row !== undefined && String(port.row) === String(leg.row));
    return byRow || guidelinePorts[leg.index] || null;
}

function dateScoringContext(trustworthyRotation, expectedTransitions, guidelinePorts, service, operator, suppliedToday) {
    const directional = /-[NSEW]$/i.test(String(service || "").trim());
    let referenceTransition = null;
    if (expectedTransitions.length) {
        const bestRank = Math.min(...expectedTransitions.map(candidate => candidate.rank));
        const top = expectedTransitions.filter(candidate => candidate.rank === bestRank);
        referenceTransition = directional ? top[0] : top[top.length - 1];
    }
    const referenceRotationIndex = referenceTransition ? referenceTransition.rotationIndex : 0;
    const now = suppliedToday instanceof Date && !Number.isNaN(suppliedToday.getTime()) ? suppliedToday : new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const base = {
        referenceRotationIndex, directional, windowDays: WINDOW_DAYS,
        referencePort: trustworthyRotation.find(leg => leg.index === referenceRotationIndex)
            ? { port: trustworthyRotation.find(leg => leg.index === referenceRotationIndex).name, portCode: trustworthyRotation.find(leg => leg.index === referenceRotationIndex).code || null }
            : null,
    };
    if (!trustworthyRotation.length) return { ...base, available: false, unavailableReason: "rotation has no trustworthy ports", case: null, baseDate: null, futureOnly: null, windowStart: null, windowEnd: null, dayOffset: null };

    if (referenceRotationIndex === 0) {
        const firstCategory = getPortCategory(trustworthyRotation[0].name);
        const secondCategory = trustworthyRotation[1] ? getPortCategory(trustworthyRotation[1].name) : null;
        const futureOnly = Boolean(secondCategory && secondCategory !== "OTHER" && secondCategory !== firstCategory);
        return { ...base, available: true, unavailableReason: null, case: 1, baseDate: today, futureOnly,
            windowStart: futureOnly ? today : addDays(today, -WINDOW_DAYS), windowEnd: addDays(today, WINDOW_DAYS), dayOffset: 0 };
    }

    const referencePosition = trustworthyRotation.findIndex(leg => leg.index === referenceRotationIndex);
    const aboveLeg = referencePosition > 0 ? trustworthyRotation[referencePosition - 1] : null;
    const firstPort = guidelinePorts[0] || null;
    const abovePort = guidelinePortForLeg(guidelinePorts, aboveLeg);
    const originRaw = firstPort && firstPort.arrival;
    const aboveRaw = abovePort && abovePort.depart;
    let unavailableReason = null;
    if (!String(originRaw || "").trim()) unavailableReason = "guideline first-port arrival date missing";
    else if (!parseDate(originRaw, { operator })) unavailableReason = "guideline first-port arrival date unparseable";
    else if (!abovePort) unavailableReason = "guideline port above reference port not found";
    else if (!String(aboveRaw || "").trim()) unavailableReason = "guideline port above reference port depart date missing";
    else if (!parseDate(aboveRaw, { operator })) unavailableReason = "guideline port above reference port depart date unparseable";
    if (unavailableReason) return { ...base, available: false, unavailableReason, case: 2, baseDate: null, futureOnly: true, windowStart: null, windowEnd: null, dayOffset: null };

    const dayOffset = daysBetween(parseDate(originRaw, { operator }), parseDate(aboveRaw, { operator }));
    const baseDate = addDays(today, -dayOffset);
    return { ...base, available: true, unavailableReason: null, case: 2, baseDate, futureOnly: true,
        windowStart: baseDate, windowEnd: addDays(baseDate, WINDOW_DAYS), dayOffset };
}

function cleanlinessSuggestion(vessels, rotation, guideline, options = {}) {
    const service = guideline && guideline.service;
    const operator = guideline && guideline.operator;
    const guidelinePorts = Array.isArray(guideline && guideline.ports) ? guideline.ports : [];
    const trustworthyRotation = rotation.filter(leg => !leg.pastLoopBoundary);
    const expectedTransitions = transitionCandidates(trustworthyRotation);
    const dateContext = dateScoringContext(trustworthyRotation, expectedTransitions, guidelinePorts, service, operator, options.today);
    const eligible = vessels.filter(vessel => ["matched", "not-in-guideline"].includes(vessel.identityStatus));
    const candidates = eligible.map((vessel, sourceIndex) => {
        const actualPorts = vessel.ports.filter(port => port.hasData && !port.pastLoopBoundary)
            .sort((left, right) => left.rotationIndex - right.rotationIndex);
        const actualTransitions = transitionCandidates(actualPorts);
        const transitionEditDistance = editDistance(
            expectedTransitions.map(item => item.category),
            actualTransitions.map(item => item.category)
        );
        const missingPortCount = Math.max(0, trustworthyRotation.length - actualPorts.length);
        const anomalyCount = missingPortCount + transitionEditDistance;
        const scoreDenominator = trustworthyRotation.length + Math.max(expectedTransitions.length, actualTransitions.length, 1);
        const cleanlinessScore = scoreDenominator
            ? Math.max(0, Math.round((1 - anomalyCount / scoreDenominator) * 1000) / 10)
            : 100;
        const firstPort = vessel.ports.find(port => port.rotationIndex === 0);
        const firstPortDeparture = firstPort ? (firstPort.etd || firstPort.eta || "") : "";
        const firstPortDate = parseDate(firstPortDeparture, { operator });
        let dateProximity = null, dateProximityUnavailable = null, dateDifferenceDays = null;
        if (!dateContext.available) dateProximityUnavailable = dateContext.unavailableReason;
        else if (!firstPortDeparture) dateProximityUnavailable = "candidate first-port departure missing";
        else if (!firstPortDate) dateProximityUnavailable = "candidate first-port departure unparseable";
        else {
            dateDifferenceDays = daysBetween(dateContext.baseDate, firstPortDate);
            dateProximity = dateContext.futureOnly && dateDifferenceDays < 0 ? 0
                : roundScore(Math.max(0, 100 * (1 - Math.abs(dateDifferenceDays) / WINDOW_DAYS)));
        }
        const combinedScore = dateProximity === null
            ? cleanlinessScore
            : roundScore(cleanlinessScore * 0.6 + dateProximity * 0.4);
        return {
            vessel, sourceIndex, actualPorts, actualTransitions, transitionEditDistance,
            missingPortCount, anomalyCount, scoreDenominator, cleanlinessScore, firstPortDeparture,
            dateProximity, dateProximityUnavailable, dateDifferenceDays, combinedScore,
        };
    }).sort((left, right) =>
        right.combinedScore - left.combinedScore ||
        left.anomalyCount - right.anomalyCount ||
        right.actualPorts.length - left.actualPorts.length ||
        (left.vessel.identityStatus === "matched" ? 0 : 1) - (right.vessel.identityStatus === "matched" ? 0 : 1) ||
        left.sourceIndex - right.sourceIndex
    );

    const summaries = candidates.map(candidate => ({
        vessel: candidate.vessel.vessel,
        voyage: candidate.vessel.voyage,
        identityStatus: candidate.vessel.identityStatus,
        cleanlinessScore: candidate.cleanlinessScore,
        firstPortDeparture: candidate.firstPortDeparture,
        dateProximity: candidate.dateProximity,
        dateProximityUnavailable: candidate.dateProximityUnavailable,
        dateDifferenceDays: candidate.dateDifferenceDays,
        combinedScore: candidate.combinedScore,
        observedPortCount: candidate.actualPorts.length,
        missingPortCount: candidate.missingPortCount,
        transitionEditDistance: candidate.transitionEditDistance,
        anomalyCount: candidate.anomalyCount,
        actualTransitionSequence: candidate.actualTransitions.map(item => item.category),
    }));
    if (!candidates.length) return { suggestion: null, candidates: summaries };

    const winner = candidates[0];
    const directional = dateContext.directional;
    let suggestedTransition = null;
    if (winner.actualTransitions.length) {
        const bestRank = Math.min(...winner.actualTransitions.map(candidate => candidate.rank));
        const top = winner.actualTransitions.filter(candidate => candidate.rank === bestRank);
        suggestedTransition = directional ? top[0] : top[top.length - 1];
    }
    const fallbackPort = winner.actualPorts[0] || null;
    const suggestedPort = suggestedTransition ? {
        port: suggestedTransition.port,
        portCode: suggestedTransition.portCode,
        category: suggestedTransition.category,
        rotationIndex: suggestedTransition.rotationIndex,
        reason: `Best-ranked category entry (${suggestedTransition.fromCategory} → ${suggestedTransition.category}); ${directional ? "first" : "last"} tied candidate selected because service ${service || "(blank)"} is ${directional ? "directional" : "non-directional"}.`,
    } : fallbackPort ? {
        port: fallbackPort.port,
        portCode: fallbackPort.portCode,
        category: getPortCategory(fallbackPort.port),
        rotationIndex: fallbackPort.rotationIndex,
        reason: "No recognized USA, Japan, or EU/UK category-entry transition exists in this vessel's reported calls; using its first reported rotation port as the port-highlighting fallback.",
    } : null;
    return {
        suggestion: {
            vessel: winner.vessel.vessel,
            voyage: winner.vessel.voyage,
            guidelineMatch: winner.vessel.guidelineMatch,
            firstPortDeparture: winner.firstPortDeparture,
            cleanlinessScore: winner.cleanlinessScore,
            dateProximity: winner.dateProximity,
            dateProximityUnavailable: winner.dateProximityUnavailable,
            dateDifferenceDays: winner.dateDifferenceDays,
            combinedScore: winner.combinedScore,
            scoringBasis: {
                referenceRotationIndex: dateContext.referenceRotationIndex,
                referencePort: dateContext.referencePort,
                case: dateContext.case,
                baseDate: formatScheduleDate(dateContext.baseDate),
                futureOnly: dateContext.futureOnly,
                windowDays: dateContext.windowDays,
                windowStart: formatScheduleDate(dateContext.windowStart),
                windowEnd: formatScheduleDate(dateContext.windowEnd),
                guidelineDayOffset: dateContext.dayOffset,
                dateClosenessAvailable: dateContext.available,
                dateClosenessUnavailable: dateContext.unavailableReason,
                actualSequenceOrder: "proof calls placed in guideline rotation order, trustworthy segment only",
                expectedPortCount: trustworthyRotation.length,
                observedPortCount: winner.actualPorts.length,
                missingPortCount: winner.missingPortCount,
                expectedTransitionSequence: expectedTransitions.map(item => item.category),
                actualTransitionSequence: winner.actualTransitions.map(item => item.category),
                transitionEditDistance: winner.transitionEditDistance,
                anomalyCount: winner.anomalyCount,
                cleanlinessScoreFormula: "100 × (1 - (missing ports + transition edit distance) / (expected ports + max(expected transitions, actual transitions, 1)))",
                dateProximityFormula: "future-only past dates score 0; otherwise max(0, 100 × (1 - abs(candidate date - base date) / 7))",
                scoreFormula: "cleanliness score × 0.6 + date proximity × 0.4 when date proximity is available; otherwise cleanliness score",
                identityEligibility: "only matched and not-in-guideline vessels are eligible; identity mismatches and ambiguous guideline matches are excluded",
                tieBreak: "higher combined score, fewer anomalies, more observed ports, matched identity before not-in-guideline, then first proof appearance",
            },
            suggestedPort,
        },
        candidates: summaries,
    };
}

function comparableVoyage(value) {
    const normalized = coreVoyage(value);
    return /^\d+$/.test(normalized) ? Number(normalized) : null;
}

function firstPortDeparture(vessel) {
    const firstPort = Array.isArray(vessel && vessel.ports)
        ? vessel.ports.find(port => port.rotationIndex === 0) : null;
    return firstPort ? (firstPort.etd || firstPort.eta || "") : "";
}

function candidateKey(vessel, voyage) {
    return JSON.stringify([String(vessel || ""), String(voyage || "")]);
}

function buildTradetechVesselList(vessels, cleanliness, operator, options = {}) {
    const suggestion = cleanliness.suggestion;
    if (!suggestion) return [];
    const summaries = Array.isArray(cleanliness.candidates) ? cleanliness.candidates : [];
    const summaryByKey = new Map(summaries.map(candidate => [candidateKey(candidate.vessel, candidate.voyage), candidate]));
    const entryFor = (vessel, role, candidate, extra = {}) => ({
        vessel: vessel.vessel,
        voyage: vessel.voyage,
        role,
        firstPortDeparture: candidate ? candidate.firstPortDeparture : firstPortDeparture(vessel),
        cleanlinessScore: candidate ? candidate.cleanlinessScore : null,
        combinedScore: candidate ? candidate.combinedScore : null,
        ...extra,
    });
    const baseVessel = vessels.find(vessel =>
        candidateKey(vessel.vessel, vessel.voyage) === candidateKey(suggestion.vessel, suggestion.voyage)
    );
    if (!baseVessel) return [];
    // "Later"/"earlier" are compared by first-port departure DATE, not voyage
    // number -- different vessels on the same service can use completely
    // independent voyage-numbering ranges (e.g. one vessel in the 20s, another
    // in the 900s), so raw voyage-number comparison across vessels is only
    // coincidentally meaningful (it happened to work when every vessel shared
    // one roughly-parallel numbering scheme, which is not a safe assumption).
    const baseDepartureDate = parseDate(firstPortDeparture(baseVessel), { operator });

    const result = [];
    if (baseDepartureDate) {
        const baseName = normalizedVesselName(baseVessel.vessel);
        const earlier = vessels.filter(vessel => {
            if (vessel === baseVessel || vessel.identityStatus !== "matched") return false;
            if (normalizedVesselName(vessel.vessel) !== baseName) return false;
            const date = parseDate(firstPortDeparture(vessel), { operator });
            return date && date < baseDepartureDate;
        }).sort((left, right) => {
            const leftDate = parseDate(firstPortDeparture(left), { operator });
            const rightDate = parseDate(firstPortDeparture(right), { operator });
            return rightDate - leftDate; // closest-before-base (latest) first
        })[0];
        if (earlier) {
            const datedPorts = earlier.ports.map(port => ({
                port,
                date: parseDate(port.etd || port.eta, { operator }),
            })).filter(item => item.date).sort((left, right) => left.port.rotationIndex - right.port.rotationIndex);
            if (datedPorts.length >= 2) {
                const spanStart = datedPorts[0].date;
                const spanEnd = datedPorts[datedPorts.length - 1].date;
                const now = options.today instanceof Date && !Number.isNaN(options.today.getTime()) ? options.today : new Date();
                const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
                const spanDays = daysBetween(spanStart, spanEnd);
                const remainingRatio = spanDays > 0 ? daysBetween(today, spanEnd) / spanDays : 0;
                if (today > spanStart && today < spanEnd && remainingRatio >= 0.30) {
                    const earlierCandidate = summaryByKey.get(candidateKey(earlier.vessel, earlier.voyage)) || null;
                    const remainingPercent = roundScore(remainingRatio * 100);
                    result.push(entryFor(earlier, "one-off-earlier", earlierCandidate, {
                        note: `Still running an earlier voyage — include separately (${remainingPercent}% remains; ${formatScheduleDate(spanStart)} to ${formatScheduleDate(spanEnd)}).`,
                        spanStart: formatScheduleDate(spanStart),
                        spanEnd: formatScheduleDate(spanEnd),
                        scheduleRemainingPercent: remainingPercent,
                    }));
                }
            }
        }
    }

    const baseCandidate = summaryByKey.get(candidateKey(baseVessel.vessel, baseVessel.voyage)) || null;
    result.push(entryFor(baseVessel, "base", baseCandidate));

    if (baseDepartureDate) {
        const laterByName = new Map();
        for (const candidate of summaries) {
            if (candidate.identityStatus !== "matched") continue;
            const date = parseDate(candidate.firstPortDeparture, { operator });
            if (!date || date <= baseDepartureDate) continue;
            const nameKey = normalizedVesselName(candidate.vessel);
            const current = laterByName.get(nameKey);
            if (!current || date < current.date) laterByName.set(nameKey, { candidate, date });
        }
        const later = [...laterByName.values()].sort((left, right) => left.date - right.date);
        for (const { candidate } of later) {
            const sameNameCount = result.filter(entry =>
                normalizedVesselName(entry.vessel) === normalizedVesselName(candidate.vessel)
            ).length;
            if (sameNameCount >= 2) continue;
            const vessel = vessels.find(item => candidateKey(item.vessel, item.voyage) === candidateKey(candidate.vessel, candidate.voyage));
            if (vessel) result.push(entryFor(vessel, "later", candidate));
        }
    }
    return result;
}

function computeFill(guideline, proofRows, options = {}) {
    if (!guideline || typeof guideline !== "object" || Array.isArray(guideline)) throw new TypeError("guideline must be an object");
    if (!Array.isArray(proofRows)) throw new TypeError("proofRows must be an array");
    if (proofRows.some(proof => !proof || typeof proof !== "object" || Array.isArray(proof))) {
        throw new TypeError("every proof row must be an object");
    }

    const warnings = [];
    for (const proof of proofRows) {
        const imo = normalizeImo(proof.imo);
        if (proof.vessel && imo && String(vesselDictionary.lookup(proof.vessel) || "") !== imo) {
            vesselDictionary.learn(proof.vessel, imo);
        }
    }
    const template = templateFor(guideline.ports);
    const rotation = template.legs.map(leg => ({ ...leg }));
    const guidelineVessels = (Array.isArray(guideline.vessels) ? guideline.vessels : []).map((vessel, guidelineIndex) => ({
        guidelineIndex,
        name: vessel.name || "",
        voyage: vessel.voyage || "",
        normalizedVoyage: normalizeVoyage(vessel.voyage),
        vesselCode: vesselDictionary.lookup(vessel.name) || null,
        imo: normalizeImo(vessel.imo) || normalizeImo(vesselDictionary.lookup(vessel.name)),
        // "VESSEL TO BE ANNOUNCED" -- a deliberate unresolved placeholder
        // (see schedule-capture.js), never expected to appear in proof.
        isPlaceholder: Boolean(vessel.isPlaceholder),
    }));

    if (!rotation.length) warnings.push("rotation has no ports");
    if (rotation.length && !template.firstCode) warnings.push("loop closure not detectable -- first port has no code");
    if (template.loopIndex !== -1) warnings.push("rotation stops being trustworthy after its first loop closure");
    if (!guidelineVessels.length) warnings.push("guideline has no vessel identity checklist");

    const unresolved = new Map(), unmatchedProofs = [], proofGroups = new Map();
    for (let proofIndex = 0; proofIndex < proofRows.length; proofIndex++) {
        const proof = proofRows[proofIndex];
        const imo = normalizeImo(proof.imo) || normalizeImo(vesselDictionary.lookup(proof.vessel));
        const vesselCode = imo || vesselDictionary.lookup(proof.vessel) || null;
        const key = proofGroupKey(proof, vesselCode, proofIndex);
        if (!proofGroups.has(key)) {
            proofGroups.set(key, {
                vessel: proof.vessel || "", vesselCode, imo,
                voyage: coreVoyage(proof.voyage) || proof.voyage || "",
                normalizedVoyage: coreVoyage(proof.voyage) || normalizeVoyage(proof.voyage),
                observedVoyages: [], proofs: [],
            });
        }
        const group = proofGroups.get(key);
        const observedVoyage = normalizeVoyage(proof.voyage);
        if (observedVoyage && !group.observedVoyages.includes(observedVoyage)) group.observedVoyages.push(observedVoyage);
        group.proofs.push({ proof, proofIndex });
        if (!portDictionary.lookup(guideline.operator, proof.port)) {
            const operator = String(guideline.operator || ""), rawLabel = String(proof.port || "");
            const unresolvedKey = JSON.stringify([operator, rawLabel]);
            const existing = unresolved.get(unresolvedKey);
            if (existing) existing.occurrences++;
            else unresolved.set(unresolvedKey, {
                operator, rawLabel, occurrences: 1,
                exampleVessel: proof.vessel || "", exampleVoyage: proof.voyage || "",
            });
        }
    }

    const notices = [], matchedGuidelineIndexes = new Set(), vessels = [];
    for (const group of proofGroups.values()) {
        const matchingGuideline = guidelineVessels.filter(candidate =>
            group.observedVoyages.some(observedVoyage => voyagesMatch(candidate.voyage, observedVoyage))
        );
        let guidelineMatch = null, identityStatus = "not-in-guideline", identityDecision = null;
        if (matchingGuideline.length === 1) {
            guidelineMatch = matchingGuideline[0];
            matchedGuidelineIndexes.add(guidelineMatch.guidelineIndex);
            identityDecision = vesselIdentityDecision(
                group.vessel, guidelineMatch.name,
                group.vesselCode, guidelineMatch.vesselCode,
                group.imo, guidelineMatch.imo
            );
            identityStatus = identityDecision.matches ? "matched" : "vessel-name-mismatch";
            if (!identityDecision.matches) notices.push({
                type: "vessel-name-mismatch", severity: "warning",
                voyage: group.voyage, normalizedVoyage: group.normalizedVoyage,
                guidelineVessel: guidelineMatch.name, guidelineVoyage: guidelineMatch.voyage,
                proofVessel: group.vessel, proofVoyage: group.voyage,
                matchingMethod: identityDecision.method,
                message: `Voyage ${group.voyage || "(blank)"}: guideline expects vessel ${guidelineMatch.name || "(blank)"}, OCR/proof shows ${group.vessel || "(blank)"}.`,
            });
        } else if (matchingGuideline.length > 1) {
            identityStatus = "ambiguous-guideline-voyage";
            for (const candidate of matchingGuideline) matchedGuidelineIndexes.add(candidate.guidelineIndex);
            notices.push({
                type: "ambiguous-guideline-voyage", severity: "warning",
                proofVessel: group.vessel, proofVoyage: group.voyage,
                guidelineCandidates: matchingGuideline.map(candidate => ({
                    name: candidate.name, voyage: candidate.voyage, guidelineIndex: candidate.guidelineIndex,
                })),
                message: `OCR/proof voyage ${group.voyage || "(blank)"} matches ${matchingGuideline.length} guideline vessels; identity is ambiguous.`,
            });
        } else {
            notices.push({
                type: "unexpected-in-ocr", severity: "info", proofVessel: group.vessel, proofVoyage: group.voyage,
                message: `OCR/proof found vessel ${group.vessel || "(blank)"} (voyage ${group.voyage || "(blank)"}) -- not in the guideline vessel list.`,
            });
        }

        const ports = rotation.map(leg => ({
            rotationIndex: leg.index, port: leg.name, portCode: leg.code || null,
            pastLoopBoundary: leg.pastLoopBoundary, eta: "", etd: "", hasData: false,
            source: null, ocrConfidence: null, proofIndex: null, rawPortLabel: null,
            ocrCorrections: null,
            proofIndexes: [],
            reasonCode: null, note: null,
        }));
        const orderedProofs = group.proofs.map(({ proof, proofIndex }) => ({
            proof,
            proofIndex,
            portCode: normalizeCode(portDictionary.lookup(guideline.operator, proof.port)),
            observedDate: parseDate(proof.etd || proof.eta, { operator: guideline.operator }),
        })).sort((left, right) => {
            if (left.observedDate && right.observedDate) {
                return left.observedDate - right.observedDate || left.proofIndex - right.proofIndex;
            }
            if (left.observedDate) return -1;
            if (right.observedDate) return 1;
            return left.proofIndex - right.proofIndex;
        });
        const distinctObservationCounts = new Map();
        for (const item of orderedProofs) {
            if (!item.portCode) continue;
            if (!distinctObservationCounts.has(item.portCode)) distinctObservationCounts.set(item.portCode, new Set());
            distinctObservationCounts.get(item.portCode).add(`${item.proof.eta || ""}\u0000${item.proof.etd || ""}`);
        }
        const occurrences = new Map();
        for (const { proof, proofIndex, portCode, observedDate } of orderedProofs) {
            if (!portCode) {
                unmatchedProofs.push({ proof: { ...proof }, proofIndex, reason: "port-label-unresolved" });
                continue;
            }
            const candidates = rotation.filter(leg => leg.code === portCode);
            const duplicateLeg = candidates.find(candidate => {
                const candidateSlot = ports[candidate.index];
                return candidateSlot.proofIndex !== null &&
                    candidateSlot.eta === (proof.eta || "") &&
                    (candidate.pastLoopBoundary || candidateSlot.etd === (proof.etd || ""));
            });
            if (duplicateLeg) {
                ports[duplicateLeg.index].proofIndexes.push(proofIndex);
                continue;
            }
            const availableCandidates = candidates.filter(candidate => ports[candidate.index].proofIndex === null);
            const distinctCount = distinctObservationCounts.get(portCode)?.size || 0;
            let leg = null;
            if (observedDate && candidates.length > 1 && distinctCount < candidates.length) {
                // Only a partial set of a repeated port was observed. Rank its
                // possible occurrences by chronological consistency with
                // OTHER ports that have exactly one template position. This
                // resolves GOT→HAM to middle→loop-closure without imposing a
                // global monotonic order on carriers whose proof dates contain
                // known irregularities elsewhere in the rotation.
                leg = availableCandidates.map(candidate => {
                    let violations = 0, evidence = 0;
                    for (const other of orderedProofs) {
                        if (!other.observedDate || other.proofIndex === proofIndex || other.portCode === portCode) continue;
                        const otherCandidates = rotation.filter(rotationLeg => rotationLeg.code === other.portCode);
                        if (otherCandidates.length !== 1) continue;
                        const otherIndex = otherCandidates[0].index;
                        if (otherIndex <= candidates[0].index || otherIndex >= candidates[candidates.length - 1].index) continue;
                        evidence++;
                        if (observedDate < other.observedDate && candidate.index >= otherIndex) violations++;
                        if (observedDate > other.observedDate && candidate.index <= otherIndex) violations++;
                    }
                    return { candidate, violations, evidence };
                }).sort((left, right) =>
                    left.violations - right.violations || right.evidence - left.evidence ||
                    left.candidate.index - right.candidate.index
                )[0]?.candidate || null;
            } else {
                const occurrence = occurrences.get(portCode) || 0;
                leg = candidates[occurrence] || null;
                occurrences.set(portCode, occurrence + 1);
                if (leg && ports[leg.index].proofIndex !== null) leg = availableCandidates[0] || null;
            }
            if (!leg) {
                unmatchedProofs.push({
                    proof: { ...proof }, proofIndex,
                    reason: candidates.length ? "rotation-occurrence-unmatched" : "port-not-in-rotation",
                });
                continue;
            }
            const slot = ports[leg.index];
            slot.eta = proof.eta || "";
            slot.etd = leg.pastLoopBoundary ? "" : (proof.etd || "");
            slot.hasData = Boolean(slot.eta || slot.etd);
            slot.source = proof.source || "structured";
            slot.ocrConfidence = proof.ocrConfidence || null;
            slot.ocrCorrections = proof.ocrCorrections || null;
            slot.proofIndex = proofIndex;
            slot.proofIndexes.push(proofIndex);
            slot.rawPortLabel = proof.port || "";
            if (leg.pastLoopBoundary) {
                slot.reasonCode = "past-loop-boundary-arrival-only";
                slot.note = "Past loop boundary: arrival retained; departure omitted because the repeated rotation position is ambiguous.";
            }
        }

        const portsByDate = ports.filter(port => port.hasData).map(port => ({
            port,
            date: parseDate(port.etd || port.eta, { operator: guideline.operator }),
        })).filter(item => item.date).sort((left, right) =>
            left.date - right.date || left.port.rotationIndex - right.port.rotationIndex
        ).map(item => item.port);

        vessels.push({
            vessel: group.vessel, vesselCode: group.vesselCode, imo: group.imo || null, voyage: group.voyage,
            normalizedVoyage: group.normalizedVoyage,
            observedVoyages: group.observedVoyages,
            guidelineMatch: guidelineMatch ? {
                guidelineIndex: guidelineMatch.guidelineIndex, name: guidelineMatch.name,
                voyage: guidelineMatch.voyage, vesselCode: guidelineMatch.vesselCode, imo: guidelineMatch.imo || null,
            } : null,
            guidelineCandidates: matchingGuideline.length > 1 ? matchingGuideline.map(candidate => ({
                guidelineIndex: candidate.guidelineIndex, name: candidate.name, voyage: candidate.voyage,
            })) : [],
            identityStatus, identityDecision, ports, portsByDate, proofRowCount: group.proofs.length,
        });
    }

    for (const expected of guidelineVessels) {
        if (matchedGuidelineIndexes.has(expected.guidelineIndex)) continue;
        if (expected.isPlaceholder) continue; // TBA -- can never appear in proof, not a real "missing" vessel
        notices.push({
            type: "missing-in-ocr", severity: "warning",
            guidelineVessel: expected.name, guidelineVoyage: expected.voyage, guidelineImo: expected.imo || null,
            message: `Expected vessel ${expected.name || "(blank)"} (voyage ${expected.voyage || "(blank)"}) -- not found in any proof yet.`,
        });
    }

    const voyageClaims = new Map();
    for (const vessel of vessels) {
        const voyageCore = coreVoyage(vessel.normalizedVoyage);
        if (!voyageCore) continue;
        if (!voyageClaims.has(voyageCore)) voyageClaims.set(voyageCore, []);
        voyageClaims.get(voyageCore).push(vessel);
    }
    for (const [voyage, claims] of voyageClaims) {
        if (claims.length < 2) continue;
        notices.push({
            type: "ambiguous-proof-voyage", severity: "warning", voyage,
            proofVessels: claims.map(claim => claim.vessel),
            message: `Multiple OCR/proof vessels claim voyage ${voyage}: ${claims.map(claim => claim.vessel || "(blank)").join(", ")}.`,
        });
    }

    const cleanliness = cleanlinessSuggestion(vessels, rotation, guideline, options);
    const tradetechVesselList = buildTradetechVesselList(vessels, cleanliness, guideline.operator, options);
    const unresolvedVesselMap = new Map();
    for (const vessel of vessels) {
        if (!vessel.vessel || vessel.imo || vesselDictionary.lookup(vessel.vessel)) continue;
        unresolvedVesselMap.set(normalizedVesselName(vessel.vessel), {
            vessel: vessel.vessel, exampleVoyage: vessel.voyage || "", source: "proof",
        });
    }
    for (const vessel of guidelineVessels) {
        if (vessel.isPlaceholder || !vessel.name || vessel.imo || vesselDictionary.lookup(vessel.name)) continue;
        const key = normalizedVesselName(vessel.name);
        if (!unresolvedVesselMap.has(key)) unresolvedVesselMap.set(key, {
            vessel: vessel.name, exampleVoyage: vessel.voyage || "", source: "guideline",
        });
    }

    return {
        formatVersion: 2,
        service: guideline.service || "",
        operator: guideline.operator || "",
        rotation,
        vessels,
        notices,
        suggestedVessel: cleanliness.suggestion,
        tradetechVesselList,
        unresolvedPortLabels: [...unresolved.values()],
        unresolvedVesselMappings: [...unresolvedVesselMap.values()],
        proofSummary: {
            received: proofRows.length,
            ocrProofCount: proofRows.filter(proof => proof.source === "ocr").length,
            structuredProofCount: proofRows.filter(proof => proof.source !== "ocr").length,
        },
        warnings,
        explain: {
            version: 2,
            datePolicy: "proof-only fill dates; guideline dates are used only for suggested-vessel date proximity",
            voyageMatchRule: "exact when guideline voyage has a trailing letter; otherwise compare zero-normalized voyage cores",
            proofGroupingRule: "canonical vessel code when available, otherwise normalized full vessel name, plus zero-normalized voyage core; direction-suffixed proof legs are merged and retained in observedVoyages",
            portSlotMatchRule: "fully observed repeated ports use occurrence order; partial repeated ports use proof-date order relative to uniquely positioned intervening ports",
            loopClosure: {
                found: template.loopIndex !== -1,
                index: template.loopIndex === -1 ? null : template.loopIndex,
                includedThroughIndex: template.loopIndex === -1 ? (rotation.length ? rotation.length - 1 : null) : template.loopIndex,
            },
            guidelineVessels,
            unmatchedProofs,
            cleanlinessCandidates: cleanliness.candidates,
        },
    };
}

module.exports = { computeFill };
