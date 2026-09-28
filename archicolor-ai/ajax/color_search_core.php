<?php
define('NO_KEEP_STATISTIC', true);
define('NOT_CHECK_PERMISSIONS', true);
define('BX_SECURITY_SHOW_MESSAGE', true);
require($_SERVER['DOCUMENT_ROOT'].'/bitrix/modules/main/include/prolog_before.php');

use Bitrix\Main\Context;
use Bitrix\Main\Data\Cache;
use Bitrix\Main\Web\Json;

header('Content-Type: application/json; charset=UTF-8');
CModule::IncludeModule('iblock');

const AP_COLOR_IBLOCK = 49;
const AP_CACHE_TTL = 21600; // 6h
const AP_MAX_TARGETS = 12;
const AP_MAX_LIMIT = 12;

function out($data, $status = 200) {
    http_response_code($status);
    echo Json::encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function clampf($v, $min, $max) { return max($min, min($max, (float)$v)); }
function validLab($v) {
    return is_array($v) && isset($v['l'],$v['a'],$v['b']) && is_numeric($v['l']) && is_numeric($v['a']) && is_numeric($v['b'])
        && $v['l'] >= 0 && $v['l'] <= 100 && $v['a'] >= -160 && $v['a'] <= 160 && $v['b'] >= -160 && $v['b'] <= 160;
}
function rgb2lab($r,$g,$b) {
    $lin=function($v){$v/=255;return $v>0.04045?pow(($v+0.055)/1.055,2.4):$v/12.92;};
    $r=$lin($r);$g=$lin($g);$b=$lin($b);
    $x=(0.4124564*$r+0.3575761*$g+0.1804375*$b)/0.95047;
    $y=(0.2126729*$r+0.7151522*$g+0.0721750*$b);
    $z=(0.0193339*$r+0.1191920*$g+0.9503041*$b)/1.08883;
    $f=function($t){return $t>0.008856451679?pow($t,1/3):(903.296296296*$t+16)/116;};
    $fx=$f($x);$fy=$f($y);$fz=$f($z);
    return [116*$fy-16,500*($fx-$fy),200*($fy-$fz)];
}
function de2000($x,$y) {
    $R=M_PI/180;$L1=$x[0];$a1=$x[1];$b1=$x[2];$L2=$y[0];$a2=$y[1];$b2=$y[2];
    $C1=hypot($a1,$b1);$C2=hypot($a2,$b2);$Cb=($C1+$C2)/2;$p25=6103515625;$Cb7=pow($Cb,7);
    $G=.5*(1-sqrt($Cb7/($Cb7+$p25)));$a1p=$a1*(1+$G);$a2p=$a2*(1+$G);$C1p=hypot($a1p,$b1);$C2p=hypot($a2p,$b2);
    $h1=atan2($b1,$a1p)/$R;if($h1<0)$h1+=360;$h2=atan2($b2,$a2p)/$R;if($h2<0)$h2+=360;
    $dL=$L2-$L1;$dC=$C2p-$C1p;$dh=0;if($C1p*$C2p!=0){$dh=$h2-$h1;if($dh>180)$dh-=360;elseif($dh<-180)$dh+=360;}
    $dH=2*sqrt($C1p*$C2p)*sin($dh*$R/2);$Lb=($L1+$L2)/2;$Cb2=($C1p+$C2p)/2;
    if($C1p*$C2p==0)$hb=$h1+$h2;elseif(abs($h1-$h2)<=180)$hb=($h1+$h2)/2;elseif($h1+$h2<360)$hb=($h1+$h2+360)/2;else$hb=($h1+$h2-360)/2;
    $T=1-.17*cos(($hb-30)*$R)+.24*cos(2*$hb*$R)+.32*cos((3*$hb+6)*$R)-.20*cos((4*$hb-63)*$R);
    $dt=30*exp(-pow(($hb-275)/25,2));$Cb7=pow($Cb2,7);$RC=2*sqrt($Cb7/($Cb7+$p25));
    $SL=1+.015*pow($Lb-50,2)/sqrt(20+pow($Lb-50,2));$SC=1+.045*$Cb2;$SH=1+.015*$Cb2*$T;$RT=-sin(2*$dt*$R)*$RC;
    return sqrt(pow($dL/$SL,2)+pow($dC/$SC,2)+pow($dH/$SH,2)+$RT*($dC/$SC)*($dH/$SH));
}
function palette() {
    $cache=Cache::createInstance();$id='archipaint_color_core_v1';$dir='/archipaint/color-core';
    if($cache->initCache(AP_CACHE_TTL,$id,$dir)) return $cache->getVars();
    if(!$cache->startDataCache()) return [];
    $rows=[];$rs=CIBlockElement::GetList(['ID'=>'ASC'],['IBLOCK_ID'=>AP_COLOR_IBLOCK,'ACTIVE'=>'Y'],false,false,['ID','NAME','DETAIL_PAGE_URL','PROPERTY_BACKGROUND_COLOR']);
    while($r=$rs->GetNext()){
        $hex=strtoupper(preg_replace('/[^0-9A-F]/i','',(string)$r['PROPERTY_BACKGROUND_COLOR_VALUE'])); if(strlen($hex)!==6)continue;
        $lab=rgb2lab(hexdec(substr($hex,0,2)),hexdec(substr($hex,2,2)),hexdec(substr($hex,4,2)));
        $rows[]=['id'=>(int)$r['ID'],'code'=>'AP-'.str_pad($r['ID'],5,'0',STR_PAD_LEFT),'name'=>(string)$r['NAME'],'hex'=>'#'.$hex,'url'=>(string)$r['DETAIL_PAGE_URL'],'lab'=>$lab,'s'=>mb_strtolower($r['ID'].' '.$r['NAME'].' '.$hex,'UTF-8')];
    }
    $cache->endDataCache($rows);return $rows;
}
function topk($target,$rows,$limit,$exclude=[]) {
    $best=[];$skip=array_fill_keys(array_map('strval',$exclude),true);
    foreach($rows as $c){if(isset($skip[$c['code']])||isset($skip[(string)$c['id']]))continue;$de=de2000($target,$c['lab']);
        $item=['id'=>$c['id'],'code'=>$c['code'],'name'=>$c['name'],'hex'=>$c['hex'],'url'=>$c['url'],'lab'=>['l'=>$c['lab'][0],'a'=>$c['lab'][1],'b'=>$c['lab'][2]],'deltaE'=>round($de,4)];
        $n=count($best);$pos=$n;while($pos>0 && $best[$pos-1]['deltaE']>$item['deltaE'])$pos--;if($pos<$limit){array_splice($best,$pos,0,[$item]);if(count($best)>$limit)array_pop($best);}elseif($n<$limit)$best[]=$item;
    } return $best;
}

$req=Context::getCurrent()->getRequest();$method=$req->getRequestMethod();
if($method==='POST'){
    $raw=file_get_contents('php://input');$body=json_decode($raw,true);if(!is_array($body))$body=[];
    $targets=$body['targets']??[];$limit=max(1,min(AP_MAX_LIMIT,(int)($body['limit']??3)));$exclude=$body['exclude']??[];
    if(!is_array($targets)||count($targets)<1||count($targets)>AP_MAX_TARGETS)out(['error'=>'targets must contain 1..'.AP_MAX_TARGETS.' Lab colors'],400);
    $rows=palette();$result=[];
    foreach($targets as $i=>$t){if(!validLab($t))out(['error'=>'Invalid Lab target','index'=>$i],400);$result[]=topk([(float)$t['l'],(float)$t['a'],(float)$t['b']],$rows,$limit,is_array($exclude)?$exclude:[]);}
    out(['items'=>$result,'catalogCount'=>count($rows),'formula'=>'CIEDE2000','source'=>'iblock:'.AP_COLOR_IBLOCK]);
}
if($method==='GET'){
    $q=trim((string)$req->get('q'));$limit=max(1,min(50,(int)($req->get('limit')?:25)));if(mb_strlen($q,'UTF-8')<1)out(['items'=>[]]);
    $needle=mb_strtolower(ltrim($q,'#'),'UTF-8');$found=[];foreach(palette() as $c){if(mb_strpos($c['s'],$needle,'UTF-8')!==false){$found[]=['id'=>$c['id'],'code'=>$c['code'],'name'=>$c['name'],'hex'=>$c['hex'],'url'=>$c['url'],'lab'=>['l'=>$c['lab'][0],'a'=>$c['lab'][1],'b'=>$c['lab'][2]]];if(count($found)>=$limit)break;}}
    out(['items'=>$found,'formula'=>'CIEDE2000','source'=>'iblock:'.AP_COLOR_IBLOCK]);
}
out(['error'=>'Method not allowed'],405);
