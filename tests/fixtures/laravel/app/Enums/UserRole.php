<?php

namespace App\Enums;

enum UserRole: string
{
    case OWNER = 'owner';
    case MEMBER = 'member';
}
