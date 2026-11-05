/** Return whether a calendar viewer may see the specific leave type. */
export function canSeeLeaveType(
  viewer: { id: string; role: string },
  absence: { employeeUserId: string | null; managerUserId: string | null },
): boolean {
  return (
    viewer.role === "admin" ||
    (absence.employeeUserId !== null && absence.employeeUserId === viewer.id) ||
    (viewer.role === "manager" &&
      absence.managerUserId !== null &&
      absence.managerUserId === viewer.id)
  );
}
