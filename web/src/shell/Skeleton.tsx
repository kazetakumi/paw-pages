import "./skeleton.css";

/** A shimmering stand-in for text that hasn't arrived yet. Pass `className`
 *  to borrow a real element's size instead — `av` for an avatar, say. */
export function Bone({ w, h, className }: { w?: number | string; h?: number; className?: string }) {
  return (
    <span
      className={className ? `bone ${className}` : "bone"}
      style={{ width: w, height: h }}
      aria-hidden="true"
    />
  );
}
