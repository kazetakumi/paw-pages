import { Link } from "react-router-dom";
import { Bone } from "../shell/Skeleton";

/** The pet header and tab row both tabs open on, before the pet has loaded. */
export function PetHeadSkeleton({ tab }: { tab: "Feed" | "About" }) {
  return (
    <>
      <Link className="back" to="/dashboard">
        &larr; Dashboard
      </Link>
      <div className="phead" aria-busy="true">
        <div className="phead-top" style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Bone className="av" />
          <div>
            <Bone w={160} h={28} />
            <Bone w={200} />
          </div>
        </div>
      </div>
      <nav className="tabs" aria-label="Pet">
        {(["Feed", "About"] as const).map((name) => (
          <span key={name} className={name === tab ? "tab on" : "tab"}>
            {name}
          </span>
        ))}
      </nav>
    </>
  );
}
