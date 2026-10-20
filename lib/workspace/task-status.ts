// Keep persisted status values compatible with existing database constraints.
export function taskStatusLabel(status: string) {
 return status === 'Complete' ? 'Completed' : status;
}
export function taskStatusTone(status: string) {
 return status === 'Complete' ? 'green' : status === 'In progress' ? 'blue' : status === 'Overdue' ? 'red' : 'amber';
}
