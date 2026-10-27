import { SchoolLink } from "@/components/school/school-link";

import { OfstedIcon } from "@/components/school/ofsted-icon";
import { schoolPath } from "@/lib/school-card";
import { OFSTED_LABEL } from "@/lib/school-icons";
import type { DirectorySchool } from "@/lib/schools-hub";

const PHASE_WORDS = { primary: "Primary", secondary: "Secondary" } as const;

/**
 * The schools a search, borough or filter keeps, as ranking rows (rankings/[slug]/school-ranking-list.tsx):
 * each name opens /school/[urn]; the borough folds under the name on phones.
 */
export function SchoolList({ schools }: { schools: readonly DirectorySchool[] }) {
  return (
    <table className="area-page__table area-page__ranking ranking-list schools-table" data-testid="schools-table">
      <thead>
        <tr>
          <th scope="col">School</th>
          <th scope="col" className="area-page__parent">Borough</th>
          <th scope="col">Ofsted</th>
          <th scope="col">Results</th>
        </tr>
      </thead>
      <tbody>
        {schools.map((school) => (
          <tr key={school.urn} data-testid="schools-row">
            <th scope="row">
              <SchoolLink href={schoolPath(school.urn)}>{school.name}</SchoolLink>
              <span className="area-page__note">
                {PHASE_WORDS[school.phase]}
                <span className="area-page__parent-inline">{school.borough ?? ""}</span>
              </span>
            </th>
            <td className="area-page__parent">{school.borough ?? ""}</td>
            <td>
              <span className="schools-table__ofsted">
                <OfstedIcon mark={school.ofsted} label={null} size={18} className="schools-table__swatch" />
                {school.ofsted ? OFSTED_LABEL[school.ofsted] : "Not graded"}
              </span>
            </td>
            <td>{school.topPercent !== null ? <strong>Top {school.topPercent}%</strong> : <span className="area-page__note">–</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
