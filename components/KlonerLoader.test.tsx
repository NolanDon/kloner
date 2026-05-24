/** @jest-environment jsdom */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import KlonerLoader from "./KlonerLoader";

describe("KlonerLoader", () => {
    it("renders the compact full-page loader with no label text by default", () => {
        const { container } = render(<KlonerLoader />);

        expect(container.querySelector(".fixed.inset-0")).toBeInTheDocument();
        expect(screen.queryByText(/loading/i)).toBeNull();
    });

    it("renders the smaller inline loader variant for dashboard sections", () => {
        const { container } = render(<KlonerLoader inline />);

        expect((container.firstElementChild as HTMLElement).className).toContain("min-h-[160px]");
        expect(container.querySelector(".relative.h-10.w-10")).toBeInTheDocument();
    });

    it("renders the compact icon loader used inside draft cards", () => {
        const { container } = render(<KlonerLoader icon />);

        expect(container.querySelector(".relative.h-8.w-8")).toBeInTheDocument();
        expect(container.querySelector(".border-neutral-300.border-t-neutral-700")).toBeInTheDocument();
    });
});
