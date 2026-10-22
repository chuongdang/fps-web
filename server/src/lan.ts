import { networkInterfaces, type NetworkInterfaceInfo } from 'os'

export interface LanAddress { iface: string; address: string }

type Ifaces = Record<string, NetworkInterfaceInfo[] | undefined>

const VIRTUAL = /^(docker|veth|br-|virbr|vmnet|vboxnet|vEthernet|utun|lo)/i

function isPrivate(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number]
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

// This machine's LAN IPv4 addresses (skips loopback, link-local, virtual adapters). Home/office networks (192.168, 10, 172.16-31) come first.
export function lanAddresses(ifaces: Ifaces = networkInterfaces()): LanAddress[] {
  const out: LanAddress[] = []
  for (const [iface, list] of Object.entries(ifaces)) {
    if (VIRTUAL.test(iface)) continue
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal || i.address.startsWith('169.254.')) continue
      out.push({ iface, address: i.address })
    }
  }
  return out.sort((x, y) => Number(isPrivate(y.address)) - Number(isPrivate(x.address)))
}
