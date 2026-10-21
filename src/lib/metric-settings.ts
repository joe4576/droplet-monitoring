import { Cpu, HardDrive, MemoryStick } from 'lucide-react'

export const METRICS = {
  cpu: {
    label: 'CPU usage',
    color: '#2374ef',
    Icon: Cpu,
    description: 'Total CPU utilization across all cores, normalized to 100%.',
  },
  memory: {
    label: 'Memory usage',
    color: '#0b9e91',
    Icon: MemoryStick,
    description:
      'Used memory as a percentage of total memory. Free and cached memory are excluded.',
  },
  disk: {
    label: 'Disk usage',
    color: '#8b5cdb',
    Icon: HardDrive,
    description:
      'Used space on the root filesystem. Attached volumes and other mounts are excluded.',
  },
} as const

export const formatPercent = (value: number | null | undefined) =>
  value == null ? '—' : `${value.toFixed(1)}%`
