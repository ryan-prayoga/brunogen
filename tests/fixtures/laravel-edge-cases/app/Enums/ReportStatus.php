<?php

namespace App\Enums;

enum ReportStatus: string
{
    case Draft = 'draft';
    case Published = 'published';
}
