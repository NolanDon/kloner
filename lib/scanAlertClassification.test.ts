import { classifyScanAlert } from "./scanAlertClassification";

describe("scan alert classification", () => {
    it("classifies stale target diagnostics without inventing a timeout or backend outage", () => {
        expect(classifyScanAlert({ code: "DNS_RESOLUTION_FAILED", statusCode: 504 })).toMatchObject({ statusCode: 502, severity: "warning", classification: "target_dns_failure" });
        expect(classifyScanAlert({ code: "BLOCKED", statusCode: 504 })).toMatchObject({ statusCode: 403, severity: "warning" });
        expect(classifyScanAlert({ code: "RATE_LIMITED", statusCode: 504 })).toMatchObject({ statusCode: 429, severity: "warning" });
        expect(classifyScanAlert({ code: "UNSUPPORTED_SNAPSHOT_DOCUMENT", statusCode: 500 })).toMatchObject({ statusCode: 422, severity: "warning" });
        expect(classifyScanAlert({ code: "URL_CAPTURE_STALE", message: "URL capture entered stale state before completion.", statusCode: 504 })).toMatchObject({ statusCode: 409, severity: "warning" });
        expect(classifyScanAlert({ code: "SNAPSHOT_V3_FAILED", message: "internal exception", statusCode: 500 })).toMatchObject({ statusCode: 500, severity: "critical" });
    });
    it("preserves expected plan and domain restrictions without inventing a 502", () => {
        expect(classifyScanAlert({ message: "Please upgrade before scanning a website from this request." })).toMatchObject({ statusCode: 402, severity: "warning" });
        expect(classifyScanAlert({ message: "Domain blocked for site cloning" })).toMatchObject({ statusCode: 403, severity: "warning" });
        expect(classifyScanAlert({ code: "snapshot_v3_blocked", statusCode: 403 })).toMatchObject({ statusCode: 403, severity: "warning" });
    });
    it("does not report a ready scan as a backend failure without diagnostic evidence", () => {
        expect(classifyScanAlert({ backendStatus: "ready", message: "URL capture reached a terminal error without a backend diagnostic." })).toMatchObject({ statusCode: 200, severity: "info" });
        expect(classifyScanAlert({ backendStatus: "ready", message: "Failed to apply archive" })).toMatchObject({ statusCode: 502, severity: "critical" });
    });
    it("retains real errors and distinguishes polling timeouts", () => {
        expect(classifyScanAlert({ message: "zip failed" }).severity).toBe("critical");
        expect(classifyScanAlert({ message: "Archive scan timed out before the archive was ready." })).toMatchObject({ statusCode: 504, severity: "error" });
        expect(classifyScanAlert({ message: "We couldn't confirm that your scan finished after 10 minutes." })).toMatchObject({ statusCode: 504, severity: "error" });
    });
});
