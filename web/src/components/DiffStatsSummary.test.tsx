// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DiffStatsSummary, DiffTotalStats } from "./DiffStatsSummary.js";

describe("DiffStatsSummary", () => {
  it("keeps the aggregate separate from the labeled Code and Tests groups", () => {
    // The legacy aggregate remains available to assistive technology without
    // adding a second visible Overall label beside the grouped statistics.
    render(
      <div>
        <DiffTotalStats stats={{ additions: 8, deletions: 3 }} verbose testId="aggregate" />
        <DiffStatsSummary
          splitStats={{
            code: { additions: 5, deletions: 2 },
            tests: { additions: 3, deletions: 1 },
          }}
          testId="groups"
        />
      </div>,
    );

    const aggregate = screen.getByTestId("aggregate");
    expect(aggregate).toHaveAccessibleName("Overall changes: 8 additions, 3 deletions");
    expect(aggregate).toHaveTextContent("+8 additions");
    expect(aggregate).toHaveTextContent("-3 deletions");
    expect(aggregate).not.toHaveTextContent("Overall");
    const groups = screen.getByTestId("groups");
    expect(within(groups).queryByText("Overall")).toBeNull();
    expect(within(groups).getByLabelText("Code changes: 5 additions, 2 deletions")).toBeInTheDocument();
    expect(within(groups).getByLabelText("Tests changes: 3 additions, 1 deletions")).toBeInTheDocument();
  });

  it("omits an empty Tests group while retaining nonzero Code statistics", () => {
    // A group is omitted only when both of its counters are zero.
    render(
      <DiffStatsSummary
        splitStats={{
          code: { additions: 2, deletions: 1 },
          tests: { additions: 0, deletions: 0 },
        }}
      />,
    );

    expect(screen.getByLabelText("Code changes: 2 additions, 1 deletions")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Tests changes:/)).toBeNull();
  });

  it("omits an empty Code group and renders no row when both groups are empty", () => {
    // Deletion-only activity is still substantive; only a fully empty pair
    // disappears, and two empty pairs should not leave a blank wrapper row.
    const { rerender } = render(
      <DiffStatsSummary
        splitStats={{
          code: { additions: 0, deletions: 0 },
          tests: { additions: 0, deletions: 4 },
        }}
      />,
    );

    expect(screen.queryByLabelText(/^Code changes:/)).toBeNull();
    expect(screen.getByLabelText("Tests changes: 0 additions, 4 deletions")).toBeInTheDocument();

    rerender(
      <DiffStatsSummary
        splitStats={{
          code: { additions: 0, deletions: 0 },
          tests: { additions: 0, deletions: 0 },
        }}
      />,
    );

    expect(screen.queryByTestId("diff-stats-summary")).toBeNull();
  });
});
