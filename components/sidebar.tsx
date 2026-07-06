"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, useEffect, useRef } from "react"

type NavItem = {
  href: string
  label: string
  icon: React.ReactNode
}

const HomeIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
  </svg>
)
const ClockIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)
const CalendarIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
  </svg>
)
const DocIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
  </svg>
)
const SettingsIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
)

const BookIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
  </svg>
)

const navItems: NavItem[] = [
  { href: "/",        label: "ホーム",   icon: HomeIcon },
  { href: "/clock",   label: "打刻",     icon: ClockIcon },
  { href: "/records", label: "勤怠記録", icon: CalendarIcon },
  { href: "/requests",label: "申請",     icon: DocIcon },
  { href: "/manual",  label: "マニュアル", icon: BookIcon },
]

const UsersIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
  </svg>
)
const CheckIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
  </svg>
)
const TableIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125h-1.5m2.625-1.5v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-15.75M20.625 5.625c0-.621-.504-1.125-1.125-1.125H4.5c-.621 0-1.125.504-1.125 1.125m17.25 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h13.5m-13.5 0c0 .621.504 1.125 1.125 1.125h11.25c.621 0 1.125-.504 1.125-1.125m-15.75 0v8.25" />
  </svg>
)

const CalendarHolidayIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5m-9-6h.008v.008H12V12zm0 3h.008v.008H12V15zm0 3h.008v.008H12V18zm-3-6h.008v.008H9V12zm0 3h.008v.008H9V15zm6-3h.008v.008H15V12z" />
  </svg>
)

const GearIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
)

const HistoryIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const LogoHorizontal = (
  <svg xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" viewBox="0 0 385 38" className="h-5 w-auto max-w-full"><defs><clipPath id="logo-clip"><rect width="385" height="38" fill="none"/></clipPath></defs><g clipPath="url(#logo-clip)"><path d="M47.98,23.994V22.2H35.7v1.792h3.246l-1.535,3.167-.8,1.643a10.32,10.32,0,0,0,1.032,0l.551-.062a17.657,17.657,0,0,0,3.762-.794,18.909,18.909,0,0,0,2.369-1l1.232,1.964h2.054l-1.84-2.959-.763-1.244-.118-.188H42.825l.635,1.032a14.986,14.986,0,0,1-2.033.835,15.259,15.259,0,0,1-2.366.56L40.5,23.994Z" transform="translate(4.181 2.495)" fill="#231815"/><path d="M58.352,0V1.82h-.9V0H55.909V1.82H47.781V3.587h8.128v5.87a11.448,11.448,0,0,1-2.789,1.316c-.036.012-.862.2-.9.207V6.319H55.1V4.542H47.781V6.319h2.976v5.067a11.659,11.659,0,0,1-1.974.35,3.9,3.9,0,0,1-.833-.016V13.4a7.948,7.948,0,0,0,.926-.028,18.313,18.313,0,0,0,4.325-.842,18.924,18.924,0,0,0,3-1.343.07.07,0,0,0,.006.029,5.784,5.784,0,0,0,3.169,3.341v-1.9a4.211,4.211,0,0,1-1.748-1.968,3.443,3.443,0,0,1-.17-1.189V3.587h1.918V0Z" transform="translate(5.596 0)" fill="#231815"/><path d="M56.045,27.82v-6.93h2.434V19.107H56.045V14.723H54.492v4.385h-2.5v1.783h2.5v6.93H51.33V29.6H58.92V27.82Z" transform="translate(6.011 1.654)" fill="#231815"/><path d="M50.966,22.69l2.322,3.765V23.809l-1.637-2.657a35.9,35.9,0,0,0,1.343-4.1l-1.767-.073c0,.011,0,.019,0,.043h-.443v-2.3H49.238v2.3H47.8v1.785h2.978a16.716,16.716,0,0,1-2.942,5.87l.087,2.4c.263-.271.525-.539.767-.84.193-.235.371-.5.546-.756v4.131h1.542V23.139h-.068c.077-.146.173-.284.255-.449" transform="translate(5.598 1.654)" fill="#231815"/><path d="M214.2,24.519v-6h9.7V13.662h-9.7V9.281h-3.389V24.572h-5.655V13.888h-3.1V24.519h-3v4.919h27.765V24.519Z" transform="translate(23.311 1.043)" fill="#231815"/><path d="M212.922.506,199.046,8.429v5.533l13.876-7.925,13.89,7.925V8.429Z" transform="translate(23.311 0.057)" fill="#231815"/><path d="M229.2,25.887V7.822H226.13V30.394h27.531V7.822H250.6v18.1Zm19.493-1.98V7.822h-7.268V5.579h12.24V.766H226.13l-.09,4.87h11.886l.025,2.186H231.1V23.907Zm-10.673-4.4h-3.96v-2.33h3.96Zm0-4.963h-3.96V12.116h3.96Zm7.717,4.858h-4.312V17.289h4.312Zm0-4.858h-4.312V12.016h4.312Z" transform="translate(26.472 0.086)" fill="#231815"/><rect width="14.578" height="5.264" transform="translate(311.888 0.563)" fill="#231815"/><path d="M296.081,5.559v16c0,2.229-2.769,3.076-2.769,3.076h-14.12v5.219h14.26l.142-.014c2.78-.3,8.031-2.4,7.557-8.28v-16Z" transform="translate(32.697 0.625)" fill="#231815"/><rect width="22.785" height="5.137" transform="translate(362.215 11.027)" fill="#231815"/><path d="M324.086.506h-20.3V8.773a3.011,3.011,0,0,1-2.874,2.313l.266,5.518c3.233-.139,7.649-2.354,7.516-7.9V5.77h11.474v5.2h-9.743v5.266h9.929v5.892a4.282,4.282,0,0,1-3.647,2.76H303.024v5.535h14.023l.142-.013c2.792-.3,8.041-2.4,8.041-8.281V.506Z" transform="translate(35.241 0.057)" fill="#231815"/><path d="M65.984.506V23.86A6.2,6.2,0,0,0,68.023,28.7c2.5,2.237,6.252,1.871,6.675,1.829l-.26.012h6.471V25.935H74.3l-.136.028a4.855,4.855,0,0,1-3.066-.7c-.212-.181-.486-.527.021-1.4V.506Z" transform="translate(7.728 0.057)" fill="#231815"/><path d="M87.912,22.462,87.8,9.685c0-5.593-5.494-7.186-8.4-7.237L79.3,7.053H79.3c.4.014,3.867.184,3.867,2.647,0,.027.114,12.815.114,12.815Z" transform="translate(9.287 0.275)" fill="#231815"/><path d="M113.995,9.111a5.872,5.872,0,0,0-4.317-5.864l-.38-.111H96.882V.506h-4.62v2.63H89.6v4.6h2.664V8.7L89.6,18.217v9.328l2.664-9.526v12.4h4.62V7.735h11.543c.811.376.952.835.964,1.032-.012.1-.012,10.745-.012,13.449a2.04,2.04,0,0,1-1.468.967H99.782v4.605h8.1a6.641,6.641,0,0,0,5.876-3.929l.247-.5V8.889Z" transform="translate(10.493 0.057)" fill="#231815"/><path d="M139.034,8.473V3.847H127.012L124.856.506h-5.841l2.142,3.341h-7.631V8.473h10.607l2.161,3.333H113.525v4.617h15.737l3.917,6.059h5.856l-3.91-6.059h3.91V11.805h-6.9l-2.153-3.333Z" transform="translate(13.295 0.057)" fill="#231815"/><path d="M118.034,21.3V17.885h-4.617V21.44c.225,2.7,2.1,7.384,7.523,7.384h18.106V24.209H120.94a3,3,0,0,1-2.906-2.911" transform="translate(13.283 2.01)" fill="#231815"/><path d="M142.279,7.607l10.867-7.1h-8.8l-5.667,3.68V30.423h.12v.119h12.838V25.936h-9.3V16.488h9.3V11.882h-9.359Z" transform="translate(16.241 0.057)" fill="#231815"/><path d="M165.51,21.406V2.341H151.629v29.6h3.435V30.305c3.341-.157,6.706-.523,8.471-2.505a9.26,9.26,0,0,0,1.975-6.395m-4.2,3.276c-1.043,1.142-4.082,1.26-6.179,1.395V6.956h7.261V21.463a4.666,4.666,0,0,1-1.082,3.218" transform="translate(17.758 0.263)" fill="#231815"/><rect width="3.617" height="20.167" transform="translate(207.561 2.487)" fill="#231815"/><path d="M191.184.506V23.743c0,3.269-1.49,3.1-1.959,3.119l-.054,4.143a5.425,5.425,0,0,0,3.7-1.528,7.639,7.639,0,0,0,2.021-5.734V.506Z" transform="translate(22.155 0.057)" fill="#231815"/><path d="M184.088.506H167.076V22.36c-.218,2.535-.883,3.246-1.26,3.345v5.3c3.235-1.513,4.166-3.462,4.052-8.646V11.883h7.055v2.456H171.5V28.044h3.338V18.019h2.082V31.581h3.707V29a5.78,5.78,0,0,0,3.812-1.179,5.939,5.939,0,0,0,1.971-4.883l-.026-8.647-5.756-.008v-2.4h6.357V.506Zm-.454,17.513v4.923a2.244,2.244,0,0,1-.932,2.181,3.091,3.091,0,0,1-2.073.555v-7.66Zm.454-9.9h-14.22V4.272h14.22Z" transform="translate(19.419 0.057)" fill="#231815"/><path d="M263.7,3.53V.506h-4.976v2.97h-5.319v5.3h5.032V22.584c-.286,3.34,1.047,5.2,2.177,6.158a7.546,7.546,0,0,0,5.426,1.681h13.633v-5.16l-13.981.038a1.938,1.938,0,0,1-1.939-1.938H263.7V8.773h10.423V10.5a1.541,1.541,0,0,1-.465,1.231c-.969.943-3.608,1.2-4.558,1.177l.191,5.536c.532.011,5.313.08,8.217-2.725a7.064,7.064,0,0,0,2.165-5.219V3.53Z" transform="translate(29.677 0.057)" fill="#231815"/><path d="M70.623,20.8v1.086A1.85,1.85,0,0,0,72.6,23.644s-3.777,1.395-1.982-2.842" transform="translate(8.214 2.337)" fill="#231815"/><line x2="0.252" transform="translate(8.727 13.095)" fill="#9fa0a0"/><path d="M12.277,6.143c5.694-3.418,14.59-5.9,18.959.741a8.524,8.524,0,0,1,.008,6.638c-2.3,4.842-7.155,7.911-12.287,9.446,3.068-1.79,5.885-4.348,6.4-8.164.754-4.345-2.839-7.145-6.683-7.907A18.341,18.341,0,0,0,8.941,8.445a16.146,16.146,0,0,1,3.336-2.3" transform="translate(1.047 0.305)" fill="#8fc31f"/><path d="M10.88,10.281c.535.142,2.045-.674,3.164-.89a8.28,8.28,0,0,1,4.358.488c.513.269.77.521,1.285.776,3.587,3.818,1.793,9.687-1.266,13.006A62.893,62.893,0,0,1,0,36.956C5.113,31.84,10.483,27.237,14.062,20.6a5.912,5.912,0,0,0-3.344-8.16" transform="translate(0 1.043)" fill="#00a0e9"/><path d="M9.6,12.423c-.05.251,0-2.3,0-2.3" transform="translate(1.121 1.138)" fill="#9fa0a0"/><path d="M10.69.47.509.5.542,24.535l10.177-.016Z" transform="translate(0.06 0.053)" fill="#eb6100"/><path d="M10,10.236s.006,2.23.006,2.043a21.829,21.829,0,0,0-3.4-.759Z" transform="translate(0.774 1.15)" fill="#fff"/><path d="M7.567,8.662s2.092-.98,2.221-.98,0-.387,0-.387" transform="translate(0.886 0.82)" fill="#fff"/><path d="M43.918,0V1.293h-.9L43.477,0H41.93L40.668,3.549V1.8H39.2V0H37.648V1.8H36.309V3.6h1.339v.054L36.309,6.166V8.982l1.339-2.5v8.47H39.2V6.481l1.419,2.5V6.166L39.2,3.669V3.6h1.456l-.211.572H42l.389-1.11h1.524V4.533H41.25V6.318h2.667v.106l-3.093,4.382v2.824l3.093-4.4v5.717h1.548V9.174l3.1,4.379v-2.8l-3.1-4.4v-.03h2.806V4.533H45.465V3.067h2.583V1.293H45.465V0Z" transform="translate(4.264)" fill="#231815"/><path d="M48,18.387l-6.137-3.665-6.127,3.665v2.352l.581-.36v1.682h11.1V20.379l.584.36ZM36.483,20.281l5.378-3.215,5.383,3.215Z" transform="translate(4.195 1.729)" fill="#231815"/></g></svg>
)

const adminItems: NavItem[] = [
  { href: "/admin/attendance", label: "勤務状況一覧",   icon: TableIcon },
  { href: "/admin/approval",   label: "勤怠承認",       icon: CheckIcon },
  { href: "/admin/requests",   label: "申請承認",       icon: DocIcon   },
  { href: "/admin/changelog",  label: "変更履歴",       icon: HistoryIcon },
  { href: "/admin/holidays",   label: "休日カレンダー", icon: CalendarHolidayIcon },
  { href: "/admin/users",      label: "ユーザー管理",   icon: UsersIcon },
  { href: "/admin/manual",     label: "管理マニュアル", icon: BookIcon },
]

const adminOnlyItems: NavItem[] = [
  { href: "/admin/approval-routes", label: "承認経路", icon: CheckIcon },
  { href: "/admin/settings",        label: "会社設定", icon: GearIcon  },
]

type Props = {
  userName: string
  userImage?: string | null
  role: string
  logoutAction: () => Promise<void>
}

export function Sidebar({ userName, userImage, role, logoutAction }: Props) {
  const pathname  = usePathname()
  const isAdmin   = role === "ADMIN" || role === "APPROVER"
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false)
  const avatarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!avatarMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [avatarMenuOpen])

  const navLink = (item: NavItem) => {
    const active = pathname === item.href
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm mb-0.5 transition-colors ${
          active
            ? "bg-gray-100 text-gray-900 font-medium"
            : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
        }`}
      >
        {item.icon}
        {item.label}
      </Link>
    )
  }

  const Avatar = () =>
    userImage ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={userImage} alt="" className="w-7 h-7 rounded-full flex-shrink-0" />
    ) : (
      <div className="w-7 h-7 rounded-full bg-gray-300 flex items-center justify-center text-xs text-gray-600 flex-shrink-0">
        {userName[0] ?? "?"}
      </div>
    )

  return (
    <>
      {/* ── デスクトップ サイドバー ── */}
      <aside className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:w-56 bg-white border-r border-gray-200 z-30">
        {/* ロゴ */}
        <div className="h-14 flex flex-col justify-center px-4 border-b border-gray-100">
          {LogoHorizontal}
          <span className="text-sm font-semibold text-gray-800 mt-0.5">勤怠管理</span>
        </div>

        {/* ナビ */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-0.5">
          {navItems.map(navLink)}
          {isAdmin && (
            <>
              <p className="px-3 pt-4 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">管理</p>
              {adminItems.map(navLink)}
              {role === "ADMIN" && adminOnlyItems.map(navLink)}
            </>
          )}
        </nav>

        {/* 下部: ユーザー */}
        <div className="border-t border-gray-100 p-2">
          <div className="flex items-center gap-2 px-3 py-2 mt-1">
            <Avatar />
            <span className="text-xs text-gray-600 flex-1 truncate min-w-0">{userName}</span>
            <form action={logoutAction}>
              <button type="submit" className="text-xs text-gray-400 hover:text-gray-700 whitespace-nowrap">
                ログアウト
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* ── モバイル ヘッダー ── */}
      <header className="lg:hidden fixed top-0 inset-x-0 h-14 bg-white border-b border-gray-200 z-30 flex items-center justify-between px-4">
        <span className="text-base font-bold text-gray-900">勤怠管理</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 truncate max-w-[120px]">{userName}</span>
          <div ref={avatarRef} className="relative">
            <button onClick={() => setAvatarMenuOpen((v) => !v)} className="block">
              <Avatar />
            </button>
            {avatarMenuOpen && (
              <div className="absolute right-0 top-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-50 min-w-[100px]">
                <form action={logoutAction}>
                  <button
                    type="submit"
                    className="block w-full px-4 py-2.5 text-sm text-left text-gray-700 hover:bg-gray-50 whitespace-nowrap"
                  >
                    ログアウト
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── モバイル ボトムナビ ── */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 z-30 flex">
        {navItems.map((item) => {
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] transition-colors ${
                active ? "text-blue-600" : "text-gray-400"
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
